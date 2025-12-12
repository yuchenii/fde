import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir, writeFile, readFile, readdir, rm, stat } from "fs/promises";

// 默认配置 - 使用系统临时目录，支持跨平台
const CHUNK_DIR = process.env.CHUNK_UPLOAD_DIR || join(tmpdir(), "fde-chunks");
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24小时

/**
 * 上传任务元数据
 */
interface UploadMetadata {
  uploadId: string;
  totalChunks: number;
  uploadedChunks: number[];
  fileName?: string;
  checksum?: string;
  env: string;
  shouldExtract: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 确保分片存储目录存在
 */
function ensureChunkDir(): void {
  if (!existsSync(CHUNK_DIR)) {
    mkdirSync(CHUNK_DIR, { recursive: true });
  }
}

/**
 * 获取上传任务目录
 */
function getUploadDir(uploadId: string): string {
  return join(CHUNK_DIR, uploadId);
}

/**
 * 获取分片文件路径
 */
function getChunkPath(uploadId: string, chunkIndex: number): string {
  return join(
    getUploadDir(uploadId),
    `chunk_${chunkIndex.toString().padStart(6, "0")}`
  );
}

/**
 * 获取元数据文件路径
 */
function getMetadataPath(uploadId: string): string {
  return join(getUploadDir(uploadId), "metadata.json");
}

/**
 * 初始化或获取上传任务
 */
export async function initUpload(
  uploadId: string,
  totalChunks: number,
  env: string,
  shouldExtract: boolean = false
): Promise<UploadMetadata> {
  ensureChunkDir();
  const uploadDir = getUploadDir(uploadId);
  const metadataPath = getMetadataPath(uploadId);

  // 如果已存在，读取现有元数据
  if (existsSync(metadataPath)) {
    const existing = JSON.parse(
      await readFile(metadataPath, "utf-8")
    ) as UploadMetadata;
    return existing;
  }

  // 创建新上传任务
  await mkdir(uploadDir, { recursive: true });

  const metadata: UploadMetadata = {
    uploadId,
    totalChunks,
    uploadedChunks: [],
    env,
    shouldExtract,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  return metadata;
}

/**
 * 获取上传状态
 */
export async function getUploadStatus(uploadId: string): Promise<{
  exists: boolean;
  uploadedChunks: number[];
  totalChunks?: number;
}> {
  const metadataPath = getMetadataPath(uploadId);

  if (!existsSync(metadataPath)) {
    return { exists: false, uploadedChunks: [] };
  }

  try {
    const metadata = JSON.parse(
      await readFile(metadataPath, "utf-8")
    ) as UploadMetadata;
    return {
      exists: true,
      uploadedChunks: metadata.uploadedChunks,
      totalChunks: metadata.totalChunks,
    };
  } catch {
    return { exists: false, uploadedChunks: [] };
  }
}

/**
 * 保存分片
 */
export async function saveChunk(
  uploadId: string,
  chunkIndex: number,
  data: Buffer
): Promise<{ success: boolean; chunkIndex: number }> {
  const uploadDir = getUploadDir(uploadId);
  const chunkPath = getChunkPath(uploadId, chunkIndex);
  const metadataPath = getMetadataPath(uploadId);

  // 确保上传目录存在
  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true });
  }

  // 保存分片
  await writeFile(chunkPath, data);

  // 更新元数据
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(
      await readFile(metadataPath, "utf-8")
    ) as UploadMetadata;
    if (!metadata.uploadedChunks.includes(chunkIndex)) {
      metadata.uploadedChunks.push(chunkIndex);
      metadata.uploadedChunks.sort((a, b) => a - b);
    }
    metadata.updatedAt = Date.now();
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  return { success: true, chunkIndex };
}

/**
 * 合并所有分片
 */
export async function mergeChunks(uploadId: string): Promise<Buffer> {
  const metadataPath = getMetadataPath(uploadId);

  if (!existsSync(metadataPath)) {
    throw new Error(`Upload ${uploadId} not found`);
  }

  const metadata = JSON.parse(
    await readFile(metadataPath, "utf-8")
  ) as UploadMetadata;

  // 检查是否所有分片都已上传
  if (metadata.uploadedChunks.length !== metadata.totalChunks) {
    throw new Error(
      `Incomplete upload: ${metadata.uploadedChunks.length}/${metadata.totalChunks} chunks received`
    );
  }

  // 按顺序读取并合并分片
  const chunks: Buffer[] = [];
  for (let i = 0; i < metadata.totalChunks; i++) {
    const chunkPath = getChunkPath(uploadId, i);
    if (!existsSync(chunkPath)) {
      throw new Error(`Missing chunk ${i}`);
    }
    chunks.push(await readFile(chunkPath));
  }

  return Buffer.concat(chunks);
}

/**
 * 删除上传任务（成功或失败后调用）
 */
export async function deleteUpload(uploadId: string): Promise<void> {
  const uploadDir = getUploadDir(uploadId);
  if (existsSync(uploadDir)) {
    await rm(uploadDir, { recursive: true, force: true });
  }
}

/**
 * 清理过期上传任务
 */
export async function cleanupExpiredUploads(): Promise<number> {
  ensureChunkDir();
  let cleaned = 0;

  try {
    const dirs = await readdir(CHUNK_DIR);
    const now = Date.now();

    for (const dir of dirs) {
      const metadataPath = join(CHUNK_DIR, dir, "metadata.json");

      try {
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(
            await readFile(metadataPath, "utf-8")
          ) as UploadMetadata;
          if (now - metadata.updatedAt > EXPIRY_MS) {
            await rm(join(CHUNK_DIR, dir), { recursive: true, force: true });
            console.log(`🗑️ Cleaned up expired upload: ${dir}`);
            cleaned++;
          }
        } else {
          // 没有元数据文件的目录，检查创建时间
          const dirStat = await stat(join(CHUNK_DIR, dir));
          if (now - dirStat.mtimeMs > EXPIRY_MS) {
            await rm(join(CHUNK_DIR, dir), { recursive: true, force: true });
            console.log(`🗑️ Cleaned up orphan upload dir: ${dir}`);
            cleaned++;
          }
        }
      } catch (e) {
        // 忽略单个目录的错误
      }
    }
  } catch (e) {
    console.error("Failed to clean up expired uploads:", e);
  }

  return cleaned;
}

/**
 * 启动定时清理任务
 */
export function startCleanupScheduler(
  intervalMs: number = 60 * 60 * 1000
): NodeJS.Timeout {
  console.log(
    `🧹 Chunk cleanup scheduler started (every ${
      intervalMs / 1000 / 60
    } minutes)`
  );

  // 启动时先清理一次
  cleanupExpiredUploads().then((count) => {
    if (count > 0) {
      console.log(`🧹 Initial cleanup: removed ${count} expired uploads`);
    }
  });

  return setInterval(() => {
    cleanupExpiredUploads().then((count) => {
      if (count > 0) {
        console.log(`🧹 Scheduled cleanup: removed ${count} expired uploads`);
      }
    });
  }, intervalMs);
}
