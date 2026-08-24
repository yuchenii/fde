import type { ServerLimitsConfig } from "../types";

// YAML 使用 MB 便于人工配置，运行时统一换算成字节。
const MB = 1024 * 1024;

/** 服务端运行时使用的字节限额。 */
export interface ResolvedServerLimits {
  chunkStorageBytes: number;
  chunkFileBytes: number;
  zipExtractBytes: number;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  field: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(
      `Invalid config: limits.${field} must be a positive integer`
    );
  }
  return resolved;
}

/**
 * 校验 server.yaml 中的 MB 配置并补齐默认值。
 * 单文件上限不能超过分片存储总容量。
 */
export function resolveServerLimits(
  limits: ServerLimitsConfig = {}
): ResolvedServerLimits {
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw new Error("Invalid config: limits must be an object");
  }

  const chunkStorageMB = positiveInteger(
    limits.chunkStorageMB,
    10 * 1024,
    "chunkStorageMB"
  );
  const chunkFileMB = positiveInteger(
    limits.chunkFileMB,
    chunkStorageMB,
    "chunkFileMB"
  );
  const zipExtractMB = positiveInteger(
    limits.zipExtractMB,
    2 * 1024,
    "zipExtractMB"
  );

  if (chunkFileMB > chunkStorageMB) {
    throw new Error(
      "Invalid config: limits.chunkFileMB cannot exceed limits.chunkStorageMB"
    );
  }

  const chunkStorageBytes = chunkStorageMB * MB;
  const chunkFileBytes = chunkFileMB * MB;
  const zipExtractBytes = zipExtractMB * MB;
  if (
    !Number.isSafeInteger(chunkStorageBytes) ||
    !Number.isSafeInteger(chunkFileBytes) ||
    !Number.isSafeInteger(zipExtractBytes)
  ) {
    throw new Error("Invalid config: limits values are too large");
  }

  return {
    chunkStorageBytes,
    chunkFileBytes,
    zipExtractBytes,
  };
}
