import { stat, createReadStream } from "fs";
import { stat as statAsync, open as openFile } from "fs/promises";
import { basename } from "path";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import cliProgress from "cli-progress";
import { calculateChecksumFromFile } from "@/utils/checksum";
import { parseJsonResponse } from "../utils/response";

/**
 * 流式上传文件（支持真实进度，兼容 Windows）
 * 使用 Node.js http/https 模块 + drain 事件获取真实网络写入进度
 */
export async function uploadFileStream(
  filePath: string,
  serverUrl: string,
  authToken: string,
  env: string,
  skipChecksum: boolean = false,
  shouldExtract: boolean = false
): Promise<any> {
  // 获取文件大小
  const stats = await statAsync(filePath);
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

  // 创建进度条
  const progressBar = new cliProgress.SingleBar({
    format:
      "📤 [{bar}] {percentage}% | {uploadedMB}/{totalMB} MB | {speed} | ETA: {eta}s",
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
    hideCursor: true,
  });

  const totalMB = (fileSize / 1024 / 1024).toFixed(2);
  progressBar.start(fileSize, 0, {
    uploadedMB: "0.00",
    totalMB: totalMB,
    speed: "0 KB/s",
    eta: "0",
  });

  // 在 Promise 外部打开文件句柄
  const CHUNK_SIZE = 64 * 1024; // 64KB per chunk
  const fileHandle = await openFile(filePath, "r");
  const buffer = Buffer.alloc(CHUNK_SIZE);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let uploadedBytes = 0;
    let bytesRead = 0;
    let totalBytesWritten = 0;

    // 更新进度条的辅助函数
    const updateProgress = (bytes: number) => {
      uploadedBytes = bytes;
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
      const remainingBytes = fileSize - uploadedBytes;
      const eta = (remainingBytes / Math.max(bytesPerSecond, 1)).toFixed(0);

      progressBar.update(uploadedBytes, {
        uploadedMB: (uploadedBytes / 1024 / 1024).toFixed(2),
        totalMB: totalMB,
        speed: speedText,
        eta: eta,
      });
    };

    // 解析 URL
    const url = new URL(`${serverUrl}/upload-stream`);
    url.searchParams.set("env", env);
    url.searchParams.set("fileName", basename(filePath));
    url.searchParams.set("shouldExtract", shouldExtract.toString());
    if (checksum) {
      url.searchParams.set("checksum", checksum);
    }

    // 选择 http 或 https
    const isHttps = url.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": fileSize,
        authorization: authToken,
      },
    };

    const req = requestFn(options, (res) => {
      let responseText = "";

      res.on("data", (chunk) => {
        responseText += chunk;
      });

      res.on("end", () => {
        // 确保进度条完成
        progressBar.update(fileSize);
        progressBar.stop();

        const result = parseJsonResponse(responseText);

        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✅ Upload completed successfully!`);
          resolve(result);
        } else {
          reject(
            new Error(
              `Server responded with ${res.statusCode}: ${
                result.error || responseText
              }`
            )
          );
        }
      });
    });

    req.on("error", async (error) => {
      await fileHandle.close().catch(() => {});
      progressBar.stop();
      console.error(`\n❌ Upload failed:`, error.message);
      reject(error);
    });

    // 手动分块读取文件并控制写入节奏
    // 这确保进度条能够正确更新，而不受 OS 缓冲区影响
    const writeNextChunk = async () => {
      try {
        const result = await fileHandle.read(buffer, 0, CHUNK_SIZE, bytesRead);

        if (result.bytesRead === 0) {
          // 文件读取完毕
          await fileHandle.close();
          req.end();
          return;
        }

        bytesRead += result.bytesRead;
        const chunk = buffer.subarray(0, result.bytesRead);

        // 写入 chunk
        const canContinue = req.write(chunk);
        totalBytesWritten += result.bytesRead;

        // 更新进度
        updateProgress(totalBytesWritten);

        if (canContinue) {
          // 缓冲区未满，使用 setImmediate 让出事件循环后继续
          // 这给进度条更新的机会
          setImmediate(writeNextChunk);
        } else {
          // 缓冲区已满，等待 drain 事件
          req.once("drain", () => {
            setImmediate(writeNextChunk);
          });
        }
      } catch (error: any) {
        await fileHandle.close().catch(() => {});
        progressBar.stop();
        console.error(`\n❌ File read failed:`, error.message);
        req.destroy();
        reject(error);
      }
    };

    // 开始写入
    writeNextChunk();
  });
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
  const { withTempZip } = await import("./archive");

  return withTempZip(dirPath, env, excludePatterns, async (tempZipPath) => {
    return uploadFileStream(
      tempZipPath,
      serverUrl,
      authToken,
      env,
      skipChecksum,
      true // 目录压缩后需要解压
    );
  });
}
