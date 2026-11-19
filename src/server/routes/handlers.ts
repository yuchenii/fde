import type { EnvironmentConfig, ServerConfig } from "../types";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveServerLimits } from "../config/limits";
import {
  hasValidToken,
  validateRequest,
  verifyFileChecksumFromPath,
} from "../services/validation";
import {
  extractFileAndDeploy,
  saveFileFromPath,
  executeDeployCommand,
  executeDeployCommandStream,
} from "../services/deployment";
import {
  startDeploy,
  addOutput,
  finishDeploy,
  shouldRejectNewDeploy,
  getDeployStatus,
  getStreamDeploy,
  type DeployRun,
  type OutputEntry,
} from "../services/deployState";
import { VERSION } from "@/version";
import {
  MAX_STANDARD_UPLOAD_SIZE,
  readJsonBody,
  readRequestBody,
  RequestBodyError,
} from "../utils/request";

function rejectIfDeployBlocked(env: string, cooldownMs: number): Response | null {
  const rejectCheck = shouldRejectNewDeploy(env, cooldownMs);
  if (!rejectCheck.reject) {
    return null;
  }
  console.log(`❌ ${rejectCheck.reason} for ${env}, rejecting request`);
  return Response.json({ error: rejectCheck.reason }, { status: 409 });
}

let standardUploadActive = false;

/**
 * 普通 multipart 上传会在解析时占用较大内存，因此当前进程只允许一个。
 */
export function claimStandardUpload(): boolean {
  if (standardUploadActive) return false;
  standardUploadActive = true;
  return true;
}

export function releaseStandardUpload(): void {
  standardUploadActive = false;
}

/** 只向客户端返回预期错误，未知异常的细节保留在服务端日志。 */
function routeErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof RequestBodyError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (
    error instanceof Error &&
    error.message.startsWith("Zip archive exceeds")
  ) {
    return Response.json({ error: error.message }, { status: 413 });
  }
  return Response.json({ error: fallback }, { status: 500 });
}

/**
 * POST /upload - 文件上传接口
 */
export async function handleUpload(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  // 在解析 multipart 前验证 Token，避免未认证的大请求占用内存。
  const token = req.headers.get("authorization");
  if (!hasValidToken(token, config)) {
    return Response.json(
      { error: token ? "Invalid token" : "Missing authorization token" },
      { status: 403 }
    );
  }
  if (!claimStandardUpload()) {
    return Response.json(
      { error: "Another standard upload is in progress" },
      { status: 503, headers: { "Retry-After": "1" } }
    );
  }

  let tempDir: string | undefined;
  try {
    // 获取上传的文件和元数据
    let rawBody: Buffer | undefined = await readRequestBody(
      req,
      MAX_STANDARD_UPLOAD_SIZE
    );
    const formData = await new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: rawBody,
    }).formData();
    rawBody = undefined;
    const file = formData.get("file");
    const env = formData.get("env") as string | null;
    const expectedChecksum = formData.get("checksum") as string | null;
    const shouldExtract = formData.get("shouldExtract") === "true";

    console.log(`\n📨 Received upload request for env: ${env || "undefined"}`);

    // 验证请求
    const validation = validateRequest(env, token, config);

    if (!validation.valid) {
      console.error(`❌ Validation failed: ${validation.error}`);
      return Response.json(
        { error: validation.error },
        {
          status: validation.error?.includes("token") ? 403 : 400,
        }
      );
    }

    if (!(file instanceof File)) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    // 使用私有临时目录处理文件，避免可预测路径和完整文件 Buffer。
    tempDir = await mkdtemp(join(tmpdir(), "fde-upload-"));
    const tempFilePath = join(tempDir, "upload.bin");
    await Bun.write(tempFilePath, file);

    console.log(
      `📤 Received file: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`
    );

    console.log(`🔍 Should extract: ${shouldExtract}`);

    // 校验文件完整性
    const checksumResult = await verifyFileChecksumFromPath(
      tempFilePath,
      file.size,
      expectedChecksum
    );
    if (checksumResult.error) {
      return checksumResult.error;
    }
    const checksumVerified = checksumResult.verified;

    // 根据标记决定处理方式
    if (shouldExtract) {
      // 解压模式：解压 zip 到目录
      await extractFileAndDeploy(
        tempFilePath,
        validation.envConfig!,
        config.limits
      );
    } else {
      // 直接保存模式：保存单个文件
      await saveFileFromPath(tempFilePath, file.name, validation.envConfig!);
    }

    console.log(`✅ File processing completed`);

    return Response.json({
      success: true,
      message: "File uploaded and processed successfully",
      fileName: file.name,
      fileSize: file.size,
      checksumVerified,
      extracted: shouldExtract,
      uploadPath: validation.envConfig!.uploadPath,
    });
  } catch (error: any) {
    console.error(`❌ Upload error:`, error);
    return routeErrorResponse(error, "Upload failed");
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch((error) =>
        console.warn(`Failed to clean upload temp directory ${tempDir}:`, error)
      );
    }
    releaseStandardUpload();
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
    const body = await readJsonBody<{ env: string; stream?: boolean }>(req);
    const { env, stream } = body ?? {};

    // 获取认证token和续接ID
    const token = req.headers.get("authorization");
    const lastEventId = req.headers.get("last-event-id");

    const deploymentId = req.headers.get("x-deployment-id");

    // 验证请求
    const validation = validateRequest(env, token, config);

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

    console.log(`\n📨 Received deploy request for env: ${env}`);
    if (stream && (lastEventId !== null || deploymentId !== null)) {
      const fromId = Number(lastEventId ?? 0);
      if (!/^\d+$/.test(lastEventId ?? "0") || !Number.isSafeInteger(fromId)) {
        return Response.json({ error: "Invalid Last-Event-ID" }, { status: 400 });
      }
      const run = getStreamDeploy(env);
      if (
        !run ||
        (deploymentId !== null && deploymentId !== run.deploymentId) ||
        (fromId !== 0 && (fromId < run.firstEventId || fromId >= run.nextId))
      ) {
        return Response.json({ error: "Deployment is no longer available" }, { status: 410 });
      }
      return deployEventStream(env, run, fromId);
    }

    const { deployCooldownMs } = resolveServerLimits(config.limits);
    const blocked = rejectIfDeployBlocked(env, deployCooldownMs);
    if (blocked) return blocked;

    const run = startDeploy(env, !!stream);
    const envConfig = validation.envConfig!;
    if (stream) {
      const response = deployEventStream(env, run, 0);
      void executeStreamDeploy(env, run, envConfig, config);
      return response;
    }

    try {
      const deployResult = await executeDeployCommand(
        envConfig.deployCommand,
        envConfig.uploadPath,
        config.configDir,
        envConfig.env
      );
      await rotateLogAfterDeploy(config);
      finishDeploy(run, { success: true, exitCode: 0 });
      return Response.json({
        success: true,
        message: `Deployment to ${env} completed successfully`,
        uploadPath: envConfig.uploadPath,
        stdout: deployResult.stdout,
        stderr: deployResult.stderr,
      });
    } catch (error: any) {
      finishDeploy(run, {
        success: false,
        exitCode: typeof error.code === "number" ? error.code : -1,
      });
      throw error;
    }
  } catch (error: any) {
    console.error(`❌ Server error:`, error);
    if (error instanceof RequestBodyError) {
      return routeErrorResponse(error, "Invalid deploy request");
    }
    return Response.json(
      {
        error: "Deploy command failed",
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
async function executeStreamDeploy(
  env: string,
  run: DeployRun,
  envConfig: EnvironmentConfig,
  config: ServerConfig
): Promise<void> {
  try {
    const { code, stdout, stderr } = await executeDeployCommandStream(
      envConfig.deployCommand,
      envConfig.uploadPath,
      config.configDir,
      (type, data) => addOutput(run, "output", { type, data }),
      envConfig.env
    );
    await rotateLogAfterDeploy(config);
    finishDeploy(run, { success: code === 0, exitCode: code });
    if (code === 0) {
      addOutput(run, "done", {
        success: true, exitCode: code, uploadPath: envConfig.uploadPath,
        message: `Deployment to ${env} completed successfully`,
      });
    } else {
      addOutput(run, "error", { error: "Deploy command failed", exitCode: code, stdout, stderr });
    }
  } catch (error) {
    console.error(`❌ Stream deploy error:`, error);
    finishDeploy(run, { success: false, exitCode: -1 });
    addOutput(run, "error", { error: "Deploy command failed", exitCode: -1 });
  }
}

/**
 * 流式部署续接处理
 */
function deployEventStream(env: string, run: DeployRun, fromId: number): Response {
  const encoder = new TextEncoder();
  let send: (entry: OutputEntry) => void;
  const stream = new ReadableStream({
    start(controller) {
      send = ({ id, event, data }) => {
        try {
          const message = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
          if (event !== "output") {
            run.listeners.delete(send);
            controller.close();
          }
        } catch {
          run.listeners.delete(send);
        }
      };
      if (run.lastResult) {
        const { success, exitCode } = run.lastResult;
        send({
          id: run.nextId - 1,
          event: success ? "done" : "error",
          data: success
            ? { success, exitCode, message: `Deployment to ${env} completed successfully` }
            : { error: "Deploy command failed", exitCode },
        });
        return;
      }
      for (const entry of run.outputBuffer) {
        if (entry.id > fromId) send(entry);
      }
      run.listeners.add(send);
    },
    cancel() {
      run.listeners.delete(send);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Deployment-ID": run.deploymentId,
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
    const token = req.headers.get("authorization");

    // 验证请求
    const validation = validateRequest(env, token, config);

    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        {
          status: validation.error?.includes("token") ? 403 : 400,
        }
      );
    }

    const status = getDeployStatus(env!, req.headers.get("x-deployment-id"));
    if (!status) {
      return Response.json({ error: "Deployment is no longer available" }, { status: 410 });
    }
    return Response.json({ env, ...status });
  } catch (error: any) {
    console.error(`❌ Deploy status error:`, error);
    return routeErrorResponse(error, "Failed to get deploy status");
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
    const body = await readJsonBody<{ env: string }>(req);
    const { env } = body ?? {};
    const token = req.headers.get("authorization");

    // 验证请求
    const validation = validateRequest(env, token, config);

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
    return routeErrorResponse(error, "Verification failed");
  }
}
