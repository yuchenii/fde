import type { ServerConfig } from "../types";
import { validateRequest, verifyFileChecksum } from "../services/validation";
import { extractAndDeploy, saveFile } from "../services/deployment";
import { throttle } from "@/utils/throttle";

// 节流日志：每秒最多打印一次
const throttledProgressLog = throttle((totalSize: number) => {
  console.log(`📥 Received ${(totalSize / 1024).toFixed(2)} KB...`);
}, 1000);

/**
 * POST /upload-stream - 流式上传接口（支持进度跟踪）
 */
export async function handleUploadStream(
  req: Request,
  config: ServerConfig
): Promise<Response> {
  try {
    // 从URL获取查询参数
    const url = new URL(req.url);
    const env = url.searchParams.get("env");
    const fileName = url.searchParams.get("fileName");
    const expectedChecksum = url.searchParams.get("checksum");
    const shouldExtract = url.searchParams.get("shouldExtract") === "true";

    // 认证token从header获取
    const authToken = req.headers.get("authorization");

    console.log(
      `\n📨 Received stream upload request for env: ${env || "undefined"}`
    );
    console.log(`📄 File name: ${fileName}`);

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

    if (!fileName) {
      return Response.json(
        { error: "Missing x-file-name header" },
        { status: 400 }
      );
    }

    // 读取整个请求体
    const body = req.body;
    if (!body) {
      return Response.json({ error: "No file data" }, { status: 400 });
    }

    // 将流转换为 Buffer
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      totalSize += value.length;

      // // 临时：模拟网络延迟
      // await new Promise((r) => setTimeout(r, 50));

      // 节流日志，每秒最多打印一次
      throttledProgressLog(totalSize);
    }

    const buffer = Buffer.concat(chunks);
    console.log(`📦 Total received: ${(buffer.length / 1024).toFixed(2)} KB`);

    // 校验文件完整性
    const checksumResult = verifyFileChecksum(buffer, expectedChecksum);
    if (checksumResult.error) {
      return checksumResult.error;
    }
    const checksumVerified = checksumResult.verified;

    // 根据标记决定处理方式
    if (shouldExtract) {
      // 解压模式：解压 zip 到目录
      await extractAndDeploy(buffer, fileName, validation.envConfig!, env!);
    } else {
      // 直接保存模式：保存单个文件
      await saveFile(buffer, fileName, validation.envConfig!, env!);
    }

    console.log(`✅ File processing completed`);

    return Response.json({
      success: true,
      message: "File uploaded and processed successfully",
      fileName: fileName,
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
