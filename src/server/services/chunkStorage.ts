import { existsSync, mkdirSync } from "fs";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { isAbsolute, join, relative, resolve } from "path";
import { tmpdir } from "os";
import { resolveServerLimits } from "../config/limits";
import type { ServerLimitsConfig } from "../types";

// 默认使用系统临时目录，支持通过已有环境变量覆盖存储位置。
const CHUNK_DIR = process.env.CHUNK_UPLOAD_DIR || join(tmpdir(), "fde-chunks");
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 小时
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const MAX_CHUNK_SIZE = 1024 * 1024;
const DEFAULT_LIMITS = resolveServerLimits();
export const MAX_CHUNK_STORAGE_SIZE = DEFAULT_LIMITS.chunkStorageBytes;
export const MAX_UPLOAD_SIZE = DEFAULT_LIMITS.chunkFileBytes;
export const MAX_TOTAL_CHUNKS = Math.ceil(
  MAX_UPLOAD_SIZE / MAX_CHUNK_SIZE
);

export function getUploadReservationSize(totalChunks: number): number {
  return Math.max(1, totalChunks) * MAX_CHUNK_SIZE;
}

/**
 * 上传任务元数据
 */
export interface UploadMetadata {
  uploadId: string;
  totalChunks: number;
  uploadedChunks: number[];
  uploadedBytes: number;
  fileName: string;
  checksum?: string;
  env: string;
  shouldExtract: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MergedUpload {
  filePath: string;
  tempDir: string;
  size: number;
  metadata: UploadMetadata;
}

// ponytail: A global lock keeps quota and metadata atomic; use per-upload locks
// if concurrent large deployments become a measured bottleneck.
let storageLock = Promise.resolve();
const activeCompletions = new Set<string>();

/** 串行执行会同时读写配额或元数据的操作。 */
function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageLock.then(operation, operation);
  storageLock = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * 确保分片存储根目录存在
 */
function ensureChunkDir(): void {
  if (!existsSync(CHUNK_DIR)) {
    mkdirSync(CHUNK_DIR, { recursive: true });
  }
}

/** 限制 ID 字符集，确保任务名不能构造目录穿越路径。 */
function assertValidUploadId(uploadId: string): void {
  if (typeof uploadId !== "string" || !UPLOAD_ID_PATTERN.test(uploadId)) {
    throw new Error(
      "Invalid uploadId: use 1-128 letters, numbers, underscores, or hyphens"
    );
  }
}

/** 校验声明的分片总数，避免无界循环和超出单文件限额。 */
function assertValidTotalChunks(
  totalChunks: number,
  maxTotalChunks: number
): void {
  if (
    !Number.isSafeInteger(totalChunks) ||
    totalChunks < 0 ||
    totalChunks > maxTotalChunks
  ) {
    throw new Error(
      `Invalid totalChunks: expected an integer between 0 and ${maxTotalChunks}`
    );
  }
}

/** 解析子路径并确认结果仍位于指定根目录内。 */
function resolveInside(baseDir: string, ...segments: string[]): string {
  const base = resolve(baseDir);
  const target = resolve(base, ...segments);
  const relativePath = relative(base, target);

  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Upload path escapes the chunk storage directory");
  }

  return target;
}

/** 使用可逆且路径安全的编码把不同环境隔离到独立目录。 */
function getEnvironmentDir(env: string): string {
  if (typeof env !== "string" || !env || Buffer.byteLength(env) > 128) {
    throw new Error("Invalid upload environment");
  }
  return resolveInside(CHUNK_DIR, Buffer.from(env).toString("base64url"));
}

/**
 * 获取按环境隔离的上传任务目录
 */
function getUploadDir(env: string, uploadId: string): string {
  assertValidUploadId(uploadId);
  return resolveInside(getEnvironmentDir(env), uploadId);
}

/**
 * 获取分片文件路径
 */
function getChunkPath(
  env: string,
  uploadId: string,
  chunkIndex: number
): string {
  return join(
    getUploadDir(env, uploadId),
    `chunk_${chunkIndex.toString().padStart(6, "0")}`
  );
}

/**
 * 获取元数据文件路径
 */
function getMetadataPath(env: string, uploadId: string): string {
  return join(getUploadDir(env, uploadId), "metadata.json");
}

/** 读取元数据时再次核对环境和任务 ID，防止目录与内容错配。 */
async function readMetadata(
  env: string,
  uploadId: string
): Promise<UploadMetadata> {
  const metadataPath = getMetadataPath(env, uploadId);
  if (!existsSync(metadataPath)) {
    throw new Error(`Upload ${uploadId} not found`);
  }

  const metadata = JSON.parse(
    await readFile(metadataPath, "utf-8")
  ) as UploadMetadata;

  if (metadata.env !== env || metadata.uploadId !== uploadId) {
    throw new Error("Upload metadata does not match the requested environment");
  }

  metadata.uploadedBytes ??= 0;
  return metadata;
}

/** 只有初始化参数完全一致时，才允许客户端续传已有任务。 */
function metadataMatches(
  metadata: UploadMetadata,
  input: {
    totalChunks: number;
    env: string;
    shouldExtract: boolean;
    fileName: string;
    checksum?: string;
  }
): boolean {
  return (
    metadata.totalChunks === input.totalChunks &&
    metadata.env === input.env &&
    metadata.shouldExtract === input.shouldExtract &&
    metadata.fileName === input.fileName &&
    metadata.checksum === input.checksum
  );
}

/**
 * 按初始化时声明的完整文件大小统计预留容量，而不是只统计已上传字节。
 */
async function calculateReservedBytes(): Promise<number> {
  let reservedBytes = 0;
  const environmentDirs = await readdir(CHUNK_DIR, { withFileTypes: true });

  for (const environmentDir of environmentDirs) {
    if (!environmentDir.isDirectory()) continue;

    const environmentPath = join(CHUNK_DIR, environmentDir.name);
    const uploadDirs = await readdir(environmentPath, { withFileTypes: true });
    for (const uploadDir of uploadDirs) {
      if (!uploadDir.isDirectory()) continue;

      try {
        const metadata = JSON.parse(
          await readFile(
            join(environmentPath, uploadDir.name, "metadata.json"),
            "utf-8"
          )
        ) as UploadMetadata;
        reservedBytes += getUploadReservationSize(metadata.totalChunks);
      } catch {
        // Orphan directories expire through the cleanup scheduler.
      }
    }
  }

  return reservedBytes;
}

/**
 * 初始化上传任务，或在元数据完全一致时恢复现有任务
 */
export async function initUpload(
  uploadId: string,
  totalChunks: number,
  env: string,
  shouldExtract: boolean,
  fileName: string,
  checksum?: string,
  limitsConfig?: ServerLimitsConfig
): Promise<UploadMetadata> {
  const limits = resolveServerLimits(limitsConfig);
  assertValidUploadId(uploadId);
  assertValidTotalChunks(
    totalChunks,
    Math.ceil(limits.chunkFileBytes / MAX_CHUNK_SIZE)
  );
  if (
    typeof fileName !== "string" ||
    !fileName ||
    Buffer.byteLength(fileName) > 255
  ) {
    throw new Error("Invalid upload fileName");
  }
  if (typeof shouldExtract !== "boolean") {
    throw new Error("Invalid shouldExtract flag");
  }
  if (checksum !== undefined && !/^[a-fA-F0-9]{64}$/.test(checksum)) {
    throw new Error("Invalid SHA-256 checksum");
  }
  ensureChunkDir();

  return withStorageLock(async () => {
    const uploadDir = getUploadDir(env, uploadId);
    const metadataPath = getMetadataPath(env, uploadId);
    const input = { totalChunks, env, shouldExtract, fileName, checksum };

    // 已存在的任务只能使用初始化时相同的服务端元数据恢复。
    if (existsSync(metadataPath)) {
      const existing = await readMetadata(env, uploadId);
      if (!metadataMatches(existing, input)) {
        throw new Error("Upload already exists with different metadata");
      }
      return existing;
    }

    // 创建任务前按完整分片数预留容量，避免并发初始化突破总配额。
    const reservedBytes = await calculateReservedBytes();
    if (
      reservedBytes + getUploadReservationSize(totalChunks) >
      limits.chunkStorageBytes
    ) {
      throw new Error("Chunk storage capacity exceeded");
    }

    await mkdir(uploadDir, { recursive: true });

    const now = Date.now();
    const metadata: UploadMetadata = {
      uploadId,
      totalChunks,
      uploadedChunks: [],
      uploadedBytes: 0,
      fileName,
      checksum,
      env,
      shouldExtract,
      createdAt: now,
      updatedAt: now,
    };

    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), {
      mode: 0o600,
    });
    return metadata;
  });
}

/**
 * 获取上传状态
 */
export async function getUploadStatus(
  env: string,
  uploadId: string
): Promise<{
  exists: boolean;
  uploadedChunks: number[];
  totalChunks?: number;
}> {
  const metadataPath = getMetadataPath(env, uploadId);
  if (!existsSync(metadataPath)) {
    return { exists: false, uploadedChunks: [] };
  }

  const metadata = await readMetadata(env, uploadId);
  return {
    exists: true,
    uploadedChunks: metadata.uploadedChunks,
    totalChunks: metadata.totalChunks,
  };
}

/**
 * 保存分片并原子更新当前进程内的任务元数据
 */
export async function saveChunk(
  env: string,
  uploadId: string,
  chunkIndex: number,
  data: Buffer,
  limitsConfig?: ServerLimitsConfig
): Promise<{ success: boolean; chunkIndex: number }> {
  if (data.length > MAX_CHUNK_SIZE) {
    throw new Error(`Chunk exceeds the ${MAX_CHUNK_SIZE}-byte limit`);
  }

  return withStorageLock(async () => {
    if (activeCompletions.has(getUploadDir(env, uploadId))) {
      throw new Error("Upload completion is already in progress");
    }

    const metadata = await readMetadata(env, uploadId);
    if (
      !Number.isSafeInteger(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex >= metadata.totalChunks
    ) {
      throw new Error("Chunk index is outside the initialized upload range");
    }

    const chunkPath = getChunkPath(env, uploadId, chunkIndex);
    const previousSize = existsSync(chunkPath)
      ? (await stat(chunkPath)).size
      : 0;
    const nextSize = metadata.uploadedBytes - previousSize + data.length;

    const maxFileBytes = resolveServerLimits(limitsConfig).chunkFileBytes;
    if (nextSize > maxFileBytes) {
      throw new Error(`Upload exceeds the ${maxFileBytes}-byte limit`);
    }

    // 分片先落盘，再更新对应任务的已上传列表和字节数。
    await writeFile(chunkPath, data, { mode: 0o600 });

    if (!metadata.uploadedChunks.includes(chunkIndex)) {
      metadata.uploadedChunks.push(chunkIndex);
      metadata.uploadedChunks.sort((a, b) => a - b);
    }
    metadata.uploadedBytes = nextSize;
    metadata.updatedAt = Date.now();
    await writeFile(
      getMetadataPath(env, uploadId),
      JSON.stringify(metadata, null, 2),
      { mode: 0o600 }
    );

    return { success: true, chunkIndex };
  });
}

/**
 * 按顺序把所有分片合并到权限受控的临时文件
 */
export async function mergeChunks(
  env: string,
  uploadId: string
): Promise<MergedUpload> {
  return withStorageLock(async () => {
    const completionKey = getUploadDir(env, uploadId);
    if (activeCompletions.has(completionKey)) {
      throw new Error("Upload completion is already in progress");
    }

    const metadata = await readMetadata(env, uploadId);

    // 合并前确认客户端声明的所有分片均已到达。
    if (metadata.uploadedChunks.length !== metadata.totalChunks) {
      throw new Error(
        `Incomplete upload: ${metadata.uploadedChunks.length}/${metadata.totalChunks} chunks received`
      );
    }

    activeCompletions.add(completionKey);
    let tempDir: string | undefined;

    try {
      tempDir = await mkdtemp(join(tmpdir(), "fde-merged-"));
      const filePath = join(tempDir, "upload.bin");
      const output = await open(filePath, "w", 0o600);
      try {
        // 逐片写入，避免把完整上传一次性载入内存。
        for (let i = 0; i < metadata.totalChunks; i++) {
          const chunkPath = getChunkPath(env, uploadId, i);
          if (!existsSync(chunkPath)) {
            throw new Error(`Missing chunk ${i}`);
          }
          const chunk = await readFile(chunkPath);
          let offset = 0;
          while (offset < chunk.length) {
            const { bytesWritten } = await output.write(
              chunk,
              offset,
              chunk.length - offset
            );
            if (bytesWritten === 0) {
              throw new Error("Failed to write merged upload");
            }
            offset += bytesWritten;
          }
        }
      } finally {
        await output.close();
      }

      return {
        filePath,
        tempDir,
        size: (await stat(filePath)).size,
        metadata,
      };
    } catch (error) {
      activeCompletions.delete(completionKey);
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    }
  });
}

/** 完成请求退出后释放任务锁，允许继续上传、取消或清理。 */
export function releaseUploadCompletion(env: string, uploadId: string): void {
  activeCompletions.delete(getUploadDir(env, uploadId));
}

/**
 * 删除环境内的上传任务（成功、校验失败或主动取消时调用）
 */
export async function deleteUpload(
  env: string,
  uploadId: string,
  completing: boolean = false
): Promise<void> {
  return withStorageLock(async () => {
    const uploadDir = getUploadDir(env, uploadId);
    if (!completing && activeCompletions.has(uploadDir)) {
      throw new Error("Upload completion is already in progress");
    }
    if (existsSync(uploadDir)) {
      await rm(uploadDir, { recursive: true, force: true });
    }
  });
}

/** 清理一个过期任务；正在合并的任务必须跳过。 */
async function cleanupUploadDirectory(
  uploadDir: string,
  label: string,
  now: number
): Promise<boolean> {
  if (activeCompletions.has(uploadDir)) return false;

  const metadataPath = join(uploadDir, "metadata.json");

  try {
    if (existsSync(metadataPath)) {
      const metadata = JSON.parse(
        await readFile(metadataPath, "utf-8")
      ) as UploadMetadata;
      if (now - metadata.updatedAt <= EXPIRY_MS) {
        return false;
      }
    } else if (now - (await stat(uploadDir)).mtimeMs <= EXPIRY_MS) {
      return false;
    }

    await rm(uploadDir, { recursive: true, force: true });
    console.log(`🗑️ Cleaned up expired upload: ${label}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理环境隔离目录中超过 24 小时未更新的上传任务
 */
export async function cleanupExpiredUploads(): Promise<number> {
  ensureChunkDir();

  return withStorageLock(async () => {
    let cleaned = 0;
    const now = Date.now();

    try {
      const environmentDirs = await readdir(CHUNK_DIR, {
        withFileTypes: true,
      });

      for (const environmentDir of environmentDirs) {
        if (!environmentDir.isDirectory()) continue;

        const environmentPath = join(CHUNK_DIR, environmentDir.name);
        // v1.4.2-v1.4.7 的单层任务目录不迁移、不清理，由客户端重新上传。
        const uploadDirs = await readdir(environmentPath, {
          withFileTypes: true,
        });
        for (const uploadDir of uploadDirs) {
          if (!uploadDir.isDirectory()) continue;
          cleaned += Number(
            await cleanupUploadDirectory(
              join(environmentPath, uploadDir.name),
              `${environmentDir.name}/${uploadDir.name}`,
              now
            )
          );
        }
      }
    } catch (error) {
      console.error("Failed to clean up expired uploads:", error);
    }

    return cleaned;
  });
}

/**
 * 启动分片上传定时清理任务
 */
export function startCleanupScheduler(
  intervalMs: number = 60 * 60 * 1000
): NodeJS.Timeout {
  console.log(
    `🧹 Chunk cleanup scheduler started (every ${
      intervalMs / 1000 / 60
    } minutes)`
  );

  // 启动时先清理一次当前目录布局中的过期任务。
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
