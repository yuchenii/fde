import { createHash } from "crypto";
import { rm } from "fs/promises";
import type { ServerConfig } from "../types";
import {
  validateRequest,
  verifyFileChecksumFromPath,
} from "../services/validation";
import {
  extractFileAndDeploy,
  saveFileFromPath,
} from "../services/deployment";
import {
  initUpload,
  getUploadStatus,
  saveChunk,
  mergeChunks,
  releaseUploadCompletion,
  deleteUpload,
  MAX_CHUNK_SIZE,
} from "../services/chunkStorage";
import {
  readJsonBody,
  readRequestBody,
  RequestBodyError,
} from "../utils/request";

/** 将预期的上传错误映射为状态码，同时隐藏未知内部异常。 */
function uploadErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof RequestBodyError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "";
  if (message.includes("not found")) {
    return Response.json({ error: message }, { status: 404 });
  }
  if (
    message.includes("different metadata") ||
    message.includes("already in progress")
  ) {
    return Response.json({ error: message }, { status: 409 });
  }
  if (message.includes("exceeds") || message.includes("exceeded")) {
    return Response.json({ error: message }, { status: 413 });
  }
  if (
    message.startsWith("Invalid ") ||
    message.includes("outside the initialized upload range") ||
    message.includes("escapes the chunk storage directory") ||
    message.includes("does not match the requested environment")
  ) {
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ error: fallback }, { status: 500 });
}

/**
 * GET /upload/status - 查询上传状态
 */
export async function handleUploadStatus(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const uploadId = url.searchParams.get("uploadId");
    const env = url.searchParams.get("env");
    const token = req.headers.get("authorization");

    if (!uploadId) {
      return Response.json({ error: "Missing uploadId" }, { status: 400 });
    }

    // 验证请求
    const validation = validateRequest(env, token, config);
    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        { status: validation.error?.includes("token") ? 403 : 400 }
      );
    }

    return Response.json(await getUploadStatus(env!, uploadId));
  } catch (error) {
    console.error("❌ Upload status failed:", error);
    return uploadErrorResponse(error, "Failed to get upload status");
  }
}

/**
 * POST /upload/init - 初始化上传任务
 */
export async function handleUploadInit(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    const body = await readJsonBody<{
      uploadId: string;
      totalChunks: number;
      fileName: string;
      checksum?: string;
      shouldExtract: boolean;
      env: string;
    }>(req);

    const token = req.headers.get("authorization");

    // 验证请求
    const validation = validateRequest(body.env, token, config);
    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        { status: validation.error?.includes("token") ? 403 : 400 }
      );
    }

    console.log(`\n📦 Initializing chunk upload: ${body.uploadId}`);
    console.log(`   📄 File: ${body.fileName}`);
    console.log(`   📊 Total chunks: ${body.totalChunks}`);

    const metadata = await initUpload(
      body.uploadId,
      body.totalChunks,
      body.env,
      body.shouldExtract,
      body.fileName,
      body.checksum,
      config.limits
    );

    return Response.json({
      success: true,
      uploadId: body.uploadId,
      uploadedChunks: metadata.uploadedChunks,
      totalChunks: metadata.totalChunks,
      isResume: metadata.uploadedChunks.length > 0,
    });
  } catch (error: any) {
    console.error("❌ Upload init failed:", error);
    return uploadErrorResponse(error, "Init failed");
  }
}

/**
 * POST /upload/chunk - 上传单个分片
 */
export async function handleUploadChunk(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const uploadId = url.searchParams.get("uploadId");
    const chunkIndexStr = url.searchParams.get("chunkIndex");
    const env = url.searchParams.get("env");
    const token = req.headers.get("authorization");

    if (!uploadId || chunkIndexStr === null) {
      return Response.json(
        { error: "Missing uploadId or chunkIndex" },
        { status: 400 }
      );
    }

    // 验证请求
    const validation = validateRequest(env, token, config);
    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        { status: validation.error?.includes("token") ? 403 : 400 }
      );
    }

    const chunkIndex = Number(chunkIndexStr);
    // 读取分片数据时执行实际大小限制。
    const buffer = await readRequestBody(req, MAX_CHUNK_SIZE);
    if (buffer.length === 0) {
      throw new RequestBodyError("No chunk data", 400);
    }

    // 验证分片 MD5（如果提供）
    const expectedMd5 = req.headers.get("x-chunk-md5");
    if (expectedMd5) {
      const actualMd5 = createHash("md5").update(buffer).digest("hex");
      if (actualMd5 !== expectedMd5) {
        console.error(
          `❌ Chunk ${chunkIndex} MD5 mismatch: expected ${expectedMd5}, got ${actualMd5}`
        );
        return Response.json(
          { error: "Chunk MD5 verification failed", chunkIndex },
          { status: 400 }
        );
      }
    }

    // 保存分片
    const result = await saveChunk(
      env!,
      uploadId,
      chunkIndex,
      buffer,
      config.limits
    );

    return Response.json(result);
  } catch (error: any) {
    console.error("❌ Chunk upload failed:", error);
    return uploadErrorResponse(error, "Chunk upload failed");
  }
}

/**
 * POST /upload/complete - 完成上传并合并
 */
export async function handleUploadComplete(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    const body = await readJsonBody<{
      uploadId: string;
      fileName: string;
      checksum?: string;
      shouldExtract: boolean;
      env: string;
    }>(req);

    const token = req.headers.get("authorization");

    // 验证请求
    const validation = validateRequest(body.env, token, config);
    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        { status: validation.error?.includes("token") ? 403 : 400 }
      );
    }

    console.log(`\n✅ Completing upload: ${body.uploadId}`);

    // 合并分片
    const merged = await mergeChunks(body.env, body.uploadId);
    try {
      console.log(
        `📦 Merged file size: ${(merged.size / 1024 / 1024).toFixed(2)} MB`
      );

      // 使用初始化阶段保存的校验和验证完整文件。
      const checksumResult = await verifyFileChecksumFromPath(
        merged.filePath,
        merged.size,
        merged.metadata.checksum || null
      );
      if (checksumResult.error) {
        // 校验失败后删除不可继续使用的上传任务。
        await deleteUpload(body.env, body.uploadId, true);
        return checksumResult.error;
      }

      // 文件名和解压标记均取自服务端初始化元数据。
      if (merged.metadata.shouldExtract) {
        await extractFileAndDeploy(
          merged.filePath,
          validation.envConfig!,
          config.limits
        );
      } else {
        await saveFileFromPath(
          merged.filePath,
          merged.metadata.fileName,
          validation.envConfig!
        );
      }

      // 处理成功后删除分片任务。
      await deleteUpload(body.env, body.uploadId, true);
      console.log(`✅ Upload completed and cleaned up`);

      return Response.json({
        success: true,
        message: "File uploaded and processed successfully",
        fileName: merged.metadata.fileName,
        fileSize: merged.size,
        checksumVerified: checksumResult.verified,
        extracted: merged.metadata.shouldExtract,
        uploadPath: validation.envConfig!.uploadPath,
      });
    } finally {
      // 无论部署是否成功，都释放临时合并文件和完成锁。
      await rm(merged.tempDir, { recursive: true, force: true }).catch(
        (error) =>
          console.warn(
            `Failed to clean merged upload ${merged.tempDir}:`,
            error
          )
      );
      releaseUploadCompletion(body.env, body.uploadId);
    }
  } catch (error: any) {
    console.error("❌ Upload complete failed:", error);
    return uploadErrorResponse(error, "Upload complete failed");
  }
}

/**
 * DELETE /upload - 取消上传
 */
export async function handleUploadCancel(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const uploadId = url.searchParams.get("uploadId");
    const env = url.searchParams.get("env");
    const token = req.headers.get("authorization");

    if (!uploadId) {
      return Response.json({ error: "Missing uploadId" }, { status: 400 });
    }

    // 验证请求
    const validation = validateRequest(env, token, config);
    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        { status: validation.error?.includes("token") ? 403 : 400 }
      );
    }

    await deleteUpload(env!, uploadId);
    console.log(`🗑️ Upload cancelled: ${uploadId}`);

    return Response.json({ success: true, message: "Upload cancelled" });
  } catch (error: any) {
    console.error("❌ Upload cancel failed:", error);
    return uploadErrorResponse(error, "Cancel failed");
  }
}
