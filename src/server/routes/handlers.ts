import type { ServerConfig } from "../types";
import { validateRequest, verifyFileChecksum } from "../services/validation";
import {
  extractAndDeploy,
  saveFile,
  executeDeployCommand,
} from "../services/deployment";
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
 */
export async function handleDeploy(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    // 获取环境参数
    const body = (await req.json()) as { env: string };
    const { env } = body;

    // 获取认证token（保留在header）
    const authToken = req.headers.get("authorization");

    console.log(`\n📨 Received deploy request for env: ${env || "undefined"}`);

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

    // 执行部署命令
    const deployResult = await executeDeployCommand(
      validation.envConfig!.deployCommand,
      validation.envConfig!.uploadPath,
      config.configDir
    );

    // 部署成功后检查并轮转日志文件
    try {
      const { rotateLogIfNeeded } = await import("../utils/logRotate");
      const { resolve } = await import("path");

      // 从配置获取日志路径和设置
      const logPath = config.log?.path || "./deploy-server.log";
      const logFile = resolve(process.cwd(), logPath);
      const maxSizeMB = config.log?.maxSize || 10;
      const maxBackups = config.log?.maxBackups || 5;

      rotateLogIfNeeded(logFile, {
        maxSize: maxSizeMB * 1024 * 1024,
        maxBackups: maxBackups,
      });
    } catch (error) {
      // 日志轮转失败不影响部署结果
      console.warn(`⚠️  Log rotation failed: ${error}`);
    }

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
