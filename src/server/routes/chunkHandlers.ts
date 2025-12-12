import { createHash } from "crypto";
import type { ServerConfig } from "../types";
import { validateRequest, verifyFileChecksum } from "../services/validation";
import { extractAndDeploy, saveFile } from "../services/deployment";
import {
  initUpload,
  getUploadStatus,
  saveChunk,
  mergeChunks,
  deleteUpload,
} from "../services/chunkStorage";

/**
 * GET /upload/status - 查询上传状态
 */
export async function handleUploadStatus(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  const url = new URL(req.url);
  const uploadId = url.searchParams.get("uploadId");
  const env = url.searchParams.get("env");
  const authToken = req.headers.get("authorization");

  if (!uploadId) {
    return Response.json({ error: "Missing uploadId" }, { status: 400 });
  }

  // 验证请求
  const validation = validateRequest(env, authToken, config);
  if (!validation.valid) {
    return Response.json(
      { error: validation.error },
      { status: validation.error?.includes("token") ? 403 : 400 }
    );
  }

  const status = await getUploadStatus(uploadId);
  return Response.json(status);
}

/**
 * POST /upload/init - 初始化上传任务
 */
export async function handleUploadInit(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    const body = (await req.json()) as {
      uploadId: string;
      totalChunks: number;
      fileName: string;
      checksum?: string;
      shouldExtract: boolean;
      env: string;
    };

    const authToken = req.headers.get("authorization");

    // 验证请求
    const validation = validateRequest(body.env, authToken, config);
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
      body.shouldExtract
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
    return Response.json(
      { error: "Init failed", details: error.message },
      { status: 500 }
    );
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
    const authToken = req.headers.get("authorization");

    if (!uploadId || chunkIndexStr === null) {
      return Response.json(
        { error: "Missing uploadId or chunkIndex" },
        { status: 400 }
      );
    }

    // 验证请求
    const validation = validateRequest(env, authToken, config);
    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        { status: validation.error?.includes("token") ? 403 : 400 }
      );
    }

    const chunkIndex = parseInt(chunkIndexStr);
    const body = req.body;
    if (!body) {
      return Response.json({ error: "No chunk data" }, { status: 400 });
    }

    // 读取分片数据
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks);

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
    const result = await saveChunk(uploadId, chunkIndex, buffer);

    return Response.json(result);
  } catch (error: any) {
    console.error("❌ Chunk upload failed:", error);
    return Response.json(
      { error: "Chunk upload failed", details: error.message },
      { status: 500 }
    );
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
    const body = (await req.json()) as {
      uploadId: string;
      fileName: string;
      checksum?: string;
      shouldExtract: boolean;
      env: string;
    };

    const authToken = req.headers.get("authorization");

    // 验证请求
    const validation = validateRequest(body.env, authToken, config);
    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        { status: validation.error?.includes("token") ? 403 : 400 }
      );
    }

    console.log(`\n✅ Completing upload: ${body.uploadId}`);

    // 合并分片
    const buffer = await mergeChunks(body.uploadId);
    console.log(
      `📦 Merged file size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`
    );

    // 校验文件完整性
    const checksumResult = verifyFileChecksum(buffer, body.checksum || null);
    if (checksumResult.error) {
      // 校验失败，删除上传任务
      await deleteUpload(body.uploadId);
      return checksumResult.error;
    }
    const checksumVerified = checksumResult.verified;

    // 处理文件
    if (body.shouldExtract) {
      await extractAndDeploy(
        buffer,
        body.fileName,
        validation.envConfig!,
        body.env
      );
    } else {
      await saveFile(buffer, body.fileName, validation.envConfig!, body.env);
    }

    // 成功后删除上传任务
    await deleteUpload(body.uploadId);

    console.log(`✅ Upload completed and cleaned up`);

    return Response.json({
      success: true,
      message: "File uploaded and processed successfully",
      fileName: body.fileName,
      fileSize: buffer.length,
      checksumVerified,
      extracted: body.shouldExtract,
      uploadPath: validation.envConfig!.uploadPath,
    });
  } catch (error: any) {
    console.error("❌ Upload complete failed:", error);
    return Response.json(
      { error: "Upload complete failed", details: error.message },
      { status: 500 }
    );
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
    const authToken = req.headers.get("authorization");

    if (!uploadId) {
      return Response.json({ error: "Missing uploadId" }, { status: 400 });
    }

    // 验证请求
    const validation = validateRequest(env, authToken, config);
    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        { status: validation.error?.includes("token") ? 403 : 400 }
      );
    }

    await deleteUpload(uploadId);
    console.log(`🗑️ Upload cancelled: ${uploadId}`);

    return Response.json({ success: true, message: "Upload cancelled" });
  } catch (error: any) {
    return Response.json(
      { error: "Cancel failed", details: error.message },
      { status: 500 }
    );
  }
}
