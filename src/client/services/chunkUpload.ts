import { stat as statAsync, open as openFile } from "fs/promises";
import { basename } from "path";
import { createHash } from "crypto";
import cliProgress from "cli-progress";
import { calculateChecksumFromFile } from "@/utils/checksum";

// 分片大小 1MB
const CHUNK_SIZE = 1 * 1024 * 1024;
// 并发上传数量
const CONCURRENCY = 3;
// 重试配置
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1秒
const MAX_RETRY_DELAY = 10000; // 10秒

/**
 * 延迟函数
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 分片上传文件
 * 支持断点续传和并发上传
 */
export async function uploadFileChunked(
  filePath: string,
  serverUrl: string,
  token: string,
  env: string,
  shouldExtract: boolean = false
): Promise<any> {
  // 获取文件信息
  const stats = await statAsync(filePath);
  const fileSize = stats.size;
  const fileName = basename(filePath);

  console.log(`\n📄 Uploading file (chunked): ${fileName}`);
  console.log(`🚀 Uploading to ${serverUrl}...`);
  console.log(`📦 File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

  // 计算文件校验和（同时作为 uploadId）
  console.log(`🔐 Calculating checksum (used as uploadId)...`);
  const checksum = await calculateChecksumFromFile(filePath);
  const uploadId = checksum.substring(0, 32); // 使用前32位作为uploadId
  console.log(`✅ Upload ID: ${uploadId}`);

  // 计算分片数量
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  console.log(
    `📊 Total chunks: ${totalChunks} (${(CHUNK_SIZE / 1024 / 1024).toFixed(
      1
    )} MB each)`
  );

  // 初始化上传任务
  const initResponse = await fetch(`${serverUrl}/upload/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({
      uploadId,
      totalChunks,
      fileName,
      checksum,
      shouldExtract,
      env,
    }),
  });

  if (!initResponse.ok) {
    const error = await initResponse
      .json()
      .catch(() => ({ error: "Init failed" }));
    throw new Error((error as any).error || "Failed to initialize upload");
  }

  const initResult = (await initResponse.json()) as {
    uploadedChunks: number[];
    isResume: boolean;
  };

  // 计算需要上传的分片
  const uploadedSet = new Set(initResult.uploadedChunks);
  const chunksToUpload = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!uploadedSet.has(i)) {
      chunksToUpload.push(i);
    }
  }

  if (initResult.isResume) {
    console.log(
      `♻️  Resuming upload: ${initResult.uploadedChunks.length}/${totalChunks} chunks already uploaded`
    );
  }

  if (chunksToUpload.length === 0) {
    console.log(`✅ All chunks already uploaded, completing...`);
  } else {
    // 创建进度条
    const progressBar = new cliProgress.SingleBar({
      format: "📤 [{bar}] {percentage}% | {value}/{total} chunks | {speed}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });

    const startTime = Date.now();
    let completedChunks = initResult.uploadedChunks.length;
    progressBar.start(totalChunks, completedChunks, { speed: "0 chunks/s" });

    // 打开文件句柄
    const fileHandle = await openFile(filePath, "r");

    // 上传单个分片（不含重试）
    const uploadChunkOnce = async (
      chunkIndex: number,
      buffer: Buffer
    ): Promise<void> => {
      // 计算分片 MD5
      const chunkMd5 = createHash("md5").update(buffer).digest("hex");

      const response = await fetch(
        `${serverUrl}/upload/chunk?uploadId=${uploadId}&chunkIndex=${chunkIndex}&env=${env}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            Authorization: token,
            "X-Chunk-MD5": chunkMd5,
          },
          body: buffer,
        }
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Chunk upload failed" }));
        throw new Error(`Chunk ${chunkIndex} failed: ${(error as any).error}`);
      }
    };

    // 带重试的分片上传
    const uploadChunkWithRetry = async (chunkIndex: number): Promise<void> => {
      const offset = chunkIndex * CHUNK_SIZE;
      const size = Math.min(CHUNK_SIZE, fileSize - offset);
      const buffer = Buffer.alloc(size);

      await fileHandle.read(buffer, 0, size, offset);

      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await uploadChunkOnce(chunkIndex, buffer);

          // 成功，更新进度
          completedChunks++;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed =
            (completedChunks - initResult.uploadedChunks.length) / elapsed;
          progressBar.update(completedChunks, {
            speed: `${speed.toFixed(1)} chunks/s`,
          });
          return;
        } catch (error: any) {
          lastError = error;

          if (attempt < MAX_RETRIES) {
            // 计算退避延迟（指数退避 + 随机抖动）
            const baseDelay = Math.min(
              INITIAL_RETRY_DELAY * Math.pow(2, attempt),
              MAX_RETRY_DELAY
            );
            const jitter = Math.random() * 500;
            const retryDelay = baseDelay + jitter;

            console.log(
              `\n⚠️  Chunk ${chunkIndex} failed, retrying in ${(
                retryDelay / 1000
              ).toFixed(1)}s... (${attempt + 1}/${MAX_RETRIES})`
            );
            await delay(retryDelay);
          }
        }
      }

      // 所有重试都失败
      throw (
        lastError ||
        new Error(`Chunk ${chunkIndex} failed after ${MAX_RETRIES} retries`)
      );
    };

    // 并发执行分片上传
    const queue = [...chunksToUpload];
    const workers: Promise<void>[] = [];

    const worker = async () => {
      while (queue.length > 0) {
        const chunkIndex = queue.shift();
        if (chunkIndex !== undefined) {
          await uploadChunkWithRetry(chunkIndex);
        }
      }
    };

    // 启动并发 workers
    for (let i = 0; i < Math.min(CONCURRENCY, chunksToUpload.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    await fileHandle.close();

    progressBar.stop();
    console.log(`✅ All chunks uploaded`);
  }

  // 完成上传
  console.log(`⚙️  Processing file on server...`);
  const completeResponse = await fetch(`${serverUrl}/upload/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({
      uploadId,
      fileName,
      checksum,
      shouldExtract,
      env,
    }),
  });

  if (!completeResponse.ok) {
    const error = await completeResponse
      .json()
      .catch(() => ({ error: "Complete failed" }));
    throw new Error(
      (error as any).error ||
        (error as any).details ||
        "Failed to complete upload"
    );
  }

  const result = await completeResponse.json();
  console.log(`✅ Upload completed successfully!`);
  return result;
}

/**
 * 分片上传目录（先压缩，再分片上传）
 */
export async function uploadDirectoryChunked(
  dirPath: string,
  serverUrl: string,
  token: string,
  env: string,
  excludePatterns: string[] = []
): Promise<any> {
  const { withTempZip } = await import("./archive");

  return withTempZip(dirPath, env, excludePatterns, async (tempZipPath) => {
    return uploadFileChunked(
      tempZipPath,
      serverUrl,
      token,
      env,
      true // 目录压缩后需要解压
    );
  });
}
