import { stat } from "fs/promises";
import { basename } from "path";
import cliProgress from "cli-progress";
import { calculateChecksumFromFile } from "../../utils/checksum";

/**
 * 流式上传文件（支持真实进度）
 */
export async function uploadFileStream(
  filePath: string,
  serverUrl: string,
  authToken: string,
  env: string,
  skipChecksum: boolean = false,
  shouldExtract: boolean = false
): Promise<any> {
  try {
    // 获取文件大小
    const stats = await stat(filePath);
    const fileSize = stats.size;

    // 先输出所有信息，再开始进度条
    console.log(`\n📄 Uploading file (streaming): ${basename(filePath)}`);
    console.log(`🚀 Uploading to ${serverUrl}...`);
    console.log(`📦 File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    // 计算文件校验和
    let checksum = "";
    if (!skipChecksum) {
      console.log(`🔐 Calculating checksum...`);
      checksum = await calculateChecksumFromFile(filePath);
      console.log(`✅ Checksum (SHA256): ${checksum.substring(0, 16)}...`);
    } else {
      console.log(`⏭️  Skipping checksum verification`);
    }

    // 读取文件为 Blob
    const file = Bun.file(filePath);
    const blob = await file.arrayBuffer();

    // 创建进度条
    const progressBar = new cliProgress.SingleBar({
      format:
        "📤 [{bar}] {percentage}% | {uploadedMB}/{totalMB} MB | {speed} | ETA: {eta}s",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });

    const totalMB = (blob.byteLength / 1024 / 1024).toFixed(2);
    progressBar.start(blob.byteLength, 0, {
      uploadedMB: "0.00",
      totalMB: totalMB,
      speed: "0 KB/s",
      eta: "0",
    });

    const startTime = Date.now();

    // 创建可读流并跟踪进度
    let uploadedBytes = 0;
    const stream = new ReadableStream({
      async start(controller) {
        const chunkSize = 64 * 1024; // 64KB chunks
        const uint8Array = new Uint8Array(blob);

        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.slice(
            i,
            Math.min(i + chunkSize, uint8Array.length)
          );
          controller.enqueue(chunk);

          uploadedBytes += chunk.length;

          // 计算速度
          const elapsed = Math.max((Date.now() - startTime) / 1000, 0.001);
          const bytesPerSecond = uploadedBytes / elapsed;

          // 动态速度单位
          let speedText: string;
          if (bytesPerSecond < 1024 * 1024) {
            speedText = `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
          } else if (bytesPerSecond < 1024 * 1024 * 1024) {
            speedText = `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
          } else {
            speedText = `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(
              2
            )} GB/s`;
          }

          // 计算ETA
          const remainingBytes = blob.byteLength - uploadedBytes;
          const eta = (remainingBytes / Math.max(bytesPerSecond, 1)).toFixed(0);

          progressBar.update(uploadedBytes, {
            uploadedMB: (uploadedBytes / 1024 / 1024).toFixed(2),
            totalMB: totalMB,
            speed: speedText,
            eta: eta,
          });

          // 模拟网络延迟，让进度条可见
          // await new Promise((resolve) => setTimeout(resolve, 10));
        }

        controller.close();
        progressBar.stop();
      },
    });

    // 构建查询参数
    const queryParams = new URLSearchParams({
      env,
      fileName: basename(filePath),
      shouldExtract: shouldExtract.toString(),
    });

    if (checksum) {
      queryParams.set("checksum", checksum);
    }

    // 只保留认证信息在header
    const headers: Record<string, string> = {
      authorization: authToken,
      "Content-Type": "application/octet-stream",
      "Content-Length": blob.byteLength.toString(),
    };

    // 发送流式请求
    const response = await fetch(`${serverUrl}/upload-stream?${queryParams}`, {
      method: "POST",
      headers,
      body: stream,
      duplex: "half" as any,
    });

    const responseText = await response.text();
    let result;

    try {
      result = JSON.parse(responseText);
    } catch {
      result = { raw: responseText };
    }

    if (!response.ok) {
      throw new Error(
        `Server responded with ${response.status}: ${
          result.error || responseText
        }`
      );
    }

    // 完成后输出（进度条已经换行了）
    console.log(`✅ Upload completed successfully!`);
    return result;
  } catch (error: any) {
    // 错误输出要换行，因为可能在进度条中间
    console.error(`\n❌ Upload failed:`, error.message);
    throw error;
  }
}

/**
 * 流式上传目录（先压缩，再流式上传）
 */
export async function uploadDirectoryStream(
  dirPath: string,
  serverUrl: string,
  authToken: string,
  env: string,
  excludePatterns: string[] = [],
  skipChecksum: boolean = false
): Promise<any> {
  const { createZipArchive } = await import("./archive");
  const { rm } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const tempZipPath = join(tmpdir(), `deploy-${env}-${Date.now()}.zip`);

  try {
    console.log(`\n📁 Preparing directory for upload: ${dirPath}`);

    // 压缩目录
    await createZipArchive(dirPath, tempZipPath, excludePatterns);

    // 使用流式上传压缩文件（需要解压）
    const result = await uploadFileStream(
      tempZipPath,
      serverUrl,
      authToken,
      env,
      skipChecksum,
      true // 目录压缩后需要解压
    );

    return result;
  } catch (error: any) {
    console.error(`❌ Upload failed:`, error.message);
    throw error;
  } finally {
    // 清理临时压缩文件
    try {
      await rm(tempZipPath, { force: true });
    } catch {}
  }
}
