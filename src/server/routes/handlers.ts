import type { ServerConfig } from "../types";
import { validateRequest, verifyFileChecksum } from "../services/validation";
import {
  extractAndDeploy,
  saveFile,
  executeDeployCommand,
  executeDeployCommandStream,
} from "../services/deployment";
import {
  startDeploy,
  addOutput,
  finishDeploy,
  getOutputsFrom,
  isDeploying,
  shouldRejectNewDeploy,
  getDeployStatus,
  getLatestOutputId,
} from "../services/deployState";
import { VERSION } from "@/version";

/**
 * POST /upload - 文件上传接口
 */
export async function handleUpload(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    // 获取上传的文件和元数据
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const env = formData.get("env") as string | null;
    const expectedChecksum = formData.get("checksum") as string | null;
    const shouldExtract = formData.get("shouldExtract") === "true";

    // 获取认证token（保留在header）
    const authToken = req.headers.get("authorization");

    console.log(`\n📨 Received upload request for env: ${env || "undefined"}`);

    // 验证请求
    const validation = validateRequest(env, authToken, config);

    if (!validation.valid) {
      console.error(`❌ Validation failed: ${validation.error}`);
      return Response.json(
        { error: validation.error },
        {
          status: validation.error?.includes("token") ? 403 : 400,
        }
      );
    }

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    // 读取文件为 Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(
      `📤 Received file: ${file.name} (${(buffer.length / 1024).toFixed(2)} KB)`
    );

    console.log(`🔍 Should extract: ${shouldExtract}`);

    // 校验文件完整性
    const checksumResult = verifyFileChecksum(buffer, expectedChecksum);
    if (checksumResult.error) {
      return checksumResult.error;
    }
    const checksumVerified = checksumResult.verified;

    // 根据标记决定处理方式
    if (shouldExtract) {
      // 解压模式：解压 zip 到目录
      await extractAndDeploy(buffer, file.name, validation.envConfig!, env!);
    } else {
      // 直接保存模式：保存单个文件
      await saveFile(buffer, file.name, validation.envConfig!, env!);
    }

    console.log(`✅ File processing completed`);

    return Response.json({
      success: true,
      message: "File uploaded and processed successfully",
      fileName: file.name,
      fileSize: buffer.length,
      checksumVerified,
      extracted: shouldExtract,
      uploadPath: validation.envConfig!.uploadPath,
    });
  } catch (error: any) {
    console.error(`❌ Upload error:`, error);
    return Response.json(
      {
        error: "Upload failed",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /deploy - 执行部署命令
 * 支持 stream 参数，stream=true 时返回 SSE 流式响应
 * 支持 Last-Event-ID 头，用于断连续接
 */
export async function handleDeploy(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    // 获取环境参数
    const body = (await req.json()) as { env: string; stream?: boolean };
    const { env, stream } = body;

    // 获取认证token和续接ID
    const authToken = req.headers.get("authorization");
    const lastEventId = req.headers.get("last-event-id");

    const isReconnect = lastEventId !== null;
    console.log(
      `\n📨 Received deploy request for env: ${env || "undefined"}${
        stream ? " (stream mode)" : ""
      }${isReconnect ? ` (reconnect from id: ${lastEventId})` : ""}`
    );

    // 验证请求
    const validation = validateRequest(env, authToken, config);

    if (!validation.valid) {
      console.error(`❌ Validation failed: ${validation.error}`);
      // 流式模式下也返回 JSON 错误（客户端需要能解析）
      return Response.json(
        { error: validation.error },
        {
          status: validation.error?.includes("token") ? 403 : 400,
        }
      );
    }

    // 流式模式
    if (stream) {
      // 检查是否是续接请求
      if (isReconnect) {
        const fromId = parseInt(lastEventId, 10) || 0;
        return handleDeployResume(env!, fromId, config);
      }

      // 检查是否有并发部署或冷却期（没有 Last-Event-ID 时检查）
      const rejectCheck = shouldRejectNewDeploy(env!);
      if (rejectCheck.reject) {
        console.log(`❌ ${rejectCheck.reason} for ${env}, rejecting request`);
        return Response.json({ error: rejectCheck.reason }, { status: 409 });
      }

      // 新部署
      return handleDeployStream(
        env!,
        { envConfig: validation.envConfig! },
        config
      );
    }

    // 非流式模式：原有逻辑
    const deployResult = await executeDeployCommand(
      validation.envConfig!.deployCommand,
      validation.envConfig!.uploadPath,
      config.configDir
    );

    // 部署成功后检查并轮转日志文件
    await rotateLogAfterDeploy(config);

    return Response.json({
      success: true,
      message: `Deployment to ${env} completed successfully`,
      uploadPath: validation.envConfig!.uploadPath,
      stdout: deployResult.stdout,
      stderr: deployResult.stderr,
    });
  } catch (error: any) {
    console.error(`❌ Server error:`, error);
    return Response.json(
      {
        error: "Deploy command failed",
        details: error.message,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        exitCode: error.code,
      },
      { status: 500 }
    );
  }
}

/**
 * 流式部署处理（新部署）
 */
function handleDeployStream(
  env: string,
  validation: {
    envConfig: NonNullable<ReturnType<typeof validateRequest>["envConfig"]>;
  },
  config: ServerConfig
): Response {
  const encoder = new TextEncoder();

  // 标记部署开始
  startDeploy(env);

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;

      const sendEvent = (event: string, data: any, id?: number) => {
        if (isClosed) return;
        try {
          let message = "";
          if (id !== undefined) {
            message = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(
              data
            )}\n\n`;
          } else {
            message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          }
          controller.enqueue(encoder.encode(message));
        } catch {
          isClosed = true;
        }
      };

      try {
        const result = await executeDeployCommandStream(
          validation.envConfig.deployCommand,
          validation.envConfig.uploadPath,
          config.configDir,
          (type, data) => {
            // 添加到缓冲并获取ID
            const id = addOutput(env, "output", { type, data });
            sendEvent("output", { type, data }, id);
          }
        );

        // 轮转日志
        await rotateLogAfterDeploy(config);

        if (result.code === 0) {
          const doneData = {
            success: true,
            message: `Deployment to ${env} completed successfully`,
            uploadPath: validation.envConfig.uploadPath,
            exitCode: result.code,
          };
          const id = addOutput(env, "done", doneData);
          sendEvent("done", doneData, id);
          finishDeploy(env, { success: true, exitCode: 0 });
        } else {
          const errorData = {
            error: "Deploy command failed",
            exitCode: result.code,
            stdout: result.stdout,
            stderr: result.stderr,
          };
          const id = addOutput(env, "error", errorData);
          sendEvent("error", errorData, id);
          finishDeploy(env, { success: false, exitCode: result.code });
        }
      } catch (error: any) {
        console.error(`❌ Stream deploy error:`, error);
        const errorData = {
          error: "Deploy command failed",
          details: error.message,
        };
        const id = addOutput(env, "error", errorData);
        sendEvent("error", errorData, id);
        finishDeploy(env, { success: false, exitCode: -1 });
      } finally {
        if (!isClosed) {
          try {
            controller.close();
          } catch {
            // 忽略关闭错误
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * 流式部署续接处理
 */
function handleDeployResume(
  env: string,
  fromId: number,
  config: ServerConfig
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;

      const sendEvent = (event: string, data: any, id?: number) => {
        if (isClosed) return;
        try {
          let message = "";
          if (id !== undefined) {
            message = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(
              data
            )}\n\n`;
          } else {
            message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          }
          controller.enqueue(encoder.encode(message));
        } catch {
          isClosed = true;
        }
      };

      try {
        // 检查部署状态
        if (!isDeploying(env)) {
          // 部署已完成，返回最终结果
          const status = getDeployStatus(env);
          if (status.lastResult) {
            if (status.lastResult.success) {
              sendEvent("done", {
                success: true,
                message: `Deployment to ${env} completed successfully`,
                exitCode: status.lastResult.exitCode,
              });
            } else {
              sendEvent("error", {
                error: "Deploy command failed",
                exitCode: status.lastResult.exitCode,
              });
            }
          } else {
            // 没有部署记录
            sendEvent("error", {
              error: "No deployment in progress",
            });
          }
          return;
        }

        // 部署进行中，重放缓冲的输出
        console.log(`🔄 Resuming SSE for env: ${env} from id: ${fromId}`);
        const bufferedOutputs = getOutputsFrom(env, fromId);
        for (const output of bufferedOutputs) {
          sendEvent(output.event, output.data, output.id);
        }

        // 继续监听新输出（轮询方式）
        let lastId = getLatestOutputId(env);
        while (isDeploying(env) && !isClosed) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const newOutputs = getOutputsFrom(env, lastId);
          for (const output of newOutputs) {
            sendEvent(output.event, output.data, output.id);
            lastId = output.id;
          }
        }

        // 部署完成，发送仍在缓冲中的最终消息
        const finalOutputs = getOutputsFrom(env, lastId);
        for (const output of finalOutputs) {
          sendEvent(output.event, output.data, output.id);
        }
      } catch (error: any) {
        console.error(`❌ SSE resume error:`, error);
        sendEvent("error", {
          error: "Resume failed",
          details: error.message,
        });
      } finally {
        if (!isClosed) {
          try {
            controller.close();
          } catch {
            // 忽略关闭错误
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * GET /deploy/status - 查询部署状态
 */
export async function handleDeployStatus(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const env = url.searchParams.get("env");

    // 获取认证token
    const authToken = req.headers.get("authorization");

    // 验证请求
    const validation = validateRequest(env, authToken, config);

    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        {
          status: validation.error?.includes("token") ? 403 : 400,
        }
      );
    }

    const status = getDeployStatus(env!);

    return Response.json({
      env,
      running: status.running,
      startTime: status.startTime?.toISOString(),
      bufferedCount: status.bufferedCount,
      lastResult: status.lastResult
        ? {
            success: status.lastResult.success,
            startTime: status.lastResult.startTime.toISOString(),
            endTime: status.lastResult.endTime.toISOString(),
            exitCode: status.lastResult.exitCode,
            message: status.lastResult.message,
          }
        : null,
    });
  } catch (error: any) {
    console.error(`❌ Deploy status error:`, error);
    return Response.json(
      {
        error: "Failed to get deploy status",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * 部署后轮转日志
 */
async function rotateLogAfterDeploy(config: ServerConfig) {
  try {
    const { rotateLogIfNeeded } = await import("../utils/logRotate");
    const { resolve } = await import("path");

    const logPath = config.log?.path || "./deploy-server.log";
    const logFile = resolve(process.cwd(), logPath);
    const maxSizeMB = config.log?.maxSize || 10;
    const maxBackups = config.log?.maxBackups || 5;

    rotateLogIfNeeded(logFile, {
      maxSize: maxSizeMB * 1024 * 1024,
      maxBackups: maxBackups,
    });
  } catch (error) {
    console.warn(`⚠️  Log rotation failed: ${error}`);
  }
}

/**
 * GET /ping - 简单连接测试
 */
export function handlePing(): Response {
  return new Response("pong", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * GET /health - 健康检查
 */
export function handleHealth(config: ServerConfig): Response {
  return Response.json({
    status: "ok",
    uptime: process.uptime(),
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST /verify - 验证环境和 Token（用于 build 前预检）
 */
export async function handleVerify(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    const body = (await req.json()) as { env: string };
    const { env } = body;
    const authToken = req.headers.get("authorization");

    console.log(`\n🔐 Received verify request for env: ${env || "undefined"}`);

    // 验证请求
    const validation = validateRequest(env, authToken, config);

    if (!validation.valid) {
      console.error(`❌ Verification failed: ${validation.error}`);
      return Response.json(
        { error: validation.error },
        {
          status: validation.error?.includes("token") ? 403 : 400,
        }
      );
    }

    console.log(`✅ Verification passed for env: ${env}`);

    return Response.json({
      success: true,
      message: `Authentication verified for environment '${env}'`,
      env: env,
    });
  } catch (error: any) {
    console.error(`❌ Verify error:`, error);
    return Response.json(
      {
        error: "Verification failed",
        details: error.message,
      },
      { status: 500 }
    );
  }
}
