import { stat, createReadStream } from "fs";
import { stat as statAsync } from "fs/promises";
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

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let uploadedBytes = 0;

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

    req.on("error", (error) => {
      progressBar.stop();
      console.error(`\n❌ Upload failed:`, error.message);
      reject(error);
    });

    // 使用文件流 + drain 事件实现真实进度
    const fileStream = createReadStream(filePath, {
      highWaterMark: 64 * 1024, // 64KB chunks
    });

    let bytesWritten = 0;

    fileStream.on("data", (chunk: Buffer | string) => {
      const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesWritten += chunkBuffer.length;

      // write 返回 false 表示缓冲区已满，需要等待 drain
      const canContinue = req.write(chunkBuffer);

      if (!canContinue) {
        // 暂停文件读取，等待网络缓冲区清空
        fileStream.pause();

        req.once("drain", () => {
          // 网络缓冲区已清空，更新进度并继续读取
          updateProgress(bytesWritten);
          fileStream.resume();
        });
      } else {
        // 可以继续写入，更新进度
        updateProgress(bytesWritten);
      }
    });

    fileStream.on("end", () => {
      req.end();
    });

    fileStream.on("error", (error) => {
      progressBar.stop();
      console.error(`\n❌ File read failed:`, error.message);
      req.destroy();
      reject(error);
    });
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
