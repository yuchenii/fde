import { createHash, timingSafeEqual } from "crypto";
import type { ServerConfig, EnvironmentConfig } from "../types";
import {
  calculateChecksum,
  calculateChecksumFromFile,
} from "@/utils/checksum";

const AUTH_FAILURE_LIMIT = 3;
const AUTH_LOCK_MS = 5 * 60 * 1000;
const MAX_AUTH_FAILURE_ENTRIES = 10_000;
// 失败记录仅保存在当前进程；条目数封顶，避免伪造来源 IP 无限占用内存。
const authFailures = new Map<
  string,
  { count: number; lastFailure: number; lockedUntil: number }
>();

/** 恒时比较字符串（哈希后比较，避免长度差异泄露） */
function secureCompareStrings(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * 在解析大请求体前，先确认 Token 属于任一已配置环境。
 * 解析出 env 后仍会由 validateRequest 校验 Token 与环境的对应关系。
 */
export function hasValidToken(
  token: string | null,
  config: ServerConfig
): boolean {
  if (!token) return false;

  const validTokens = new Set<string>();
  for (const envConfig of Object.values(config.environments)) {
    const validToken = envConfig.token || config.token;
    if (validToken) validTokens.add(validToken);
  }

  let valid = false;
  for (const validToken of validTokens) {
    valid = secureCompareStrings(token, validToken) || valid;
  }
  return valid;
}

/** 返回剩余封禁秒数，未封禁时返回 0。 */
export function getAuthRetryAfter(clientId: string): number {
  const entry = authFailures.get(clientId);
  if (!entry) return 0;

  const remainingMs = entry.lockedUntil - Date.now();
  if (remainingMs <= 0) {
    if (Date.now() - entry.lastFailure >= AUTH_LOCK_MS) {
      authFailures.delete(clientId);
    }
    return 0;
  }

  return Math.ceil(remainingMs / 1000);
}

/** 记录连续认证失败，第 3 次起封禁来源 5 分钟。 */
export function recordAuthFailure(clientId: string): void {
  const now = Date.now();
  const previous = authFailures.get(clientId);
  const count =
    previous && now - previous.lastFailure < AUTH_LOCK_MS
      ? previous.count + 1
      : 1;

  if (!previous && authFailures.size >= MAX_AUTH_FAILURE_ENTRIES) {
    const oldestKey = authFailures.keys().next().value;
    if (oldestKey) authFailures.delete(oldestKey);
  }

  authFailures.set(clientId, {
    count,
    lastFailure: now,
    lockedUntil: count >= AUTH_FAILURE_LIMIT ? now + AUTH_LOCK_MS : 0,
  });
}

/** 成功认证后清除该来源的连续失败记录。 */
export function clearAuthFailures(clientId: string): void {
  authFailures.delete(clientId);
}

/**
 * 校验文件的 SHA256 校验和
 * 如果未提供校验和则跳过验证
 *
 * @param buffer 文件数据
 * @param expectedChecksum 期望的校验和（可为 null）
 * @returns { verified: 是否已验证, error: 失败时的响应 }
 */
export function verifyFileChecksum(
  buffer: Buffer,
  expectedChecksum: string | null
): { verified: boolean; error?: Response } {
  if (!expectedChecksum) {
    console.log(`⏭️  No checksum provided, skipping verification`);
    return { verified: false };
  }

  console.log(`🔐 Verifying file checksum...`);
  console.log(`📦 Received buffer size: ${buffer.length} bytes`);
  const actualChecksum = calculateChecksum(buffer);
  console.log(`📋 Expected checksum: ${expectedChecksum.substring(0, 16)}...`);
  console.log(`📋 Actual checksum:   ${actualChecksum.substring(0, 16)}...`);

  const isValid = actualChecksum === expectedChecksum;

  if (!isValid) {
    console.error(`❌ Checksum verification failed!`);
    console.error(`   Expected: ${expectedChecksum}`);
    console.error(`   Actual:   ${actualChecksum}`);
    return {
      verified: false,
      error: Response.json(
        {
          error: "Checksum verification failed",
          message:
            "File integrity check failed. The uploaded file may be corrupted.",
          expected: expectedChecksum,
          actual: actualChecksum,
          bufferSize: buffer.length,
        },
        { status: 400 }
      ),
    };
  }

  console.log(`✅ Checksum verified: ${expectedChecksum.substring(0, 16)}...`);
  return { verified: true };
}

/** 流式计算磁盘文件的 SHA256，避免把完整上传再次载入内存。 */
export async function verifyFileChecksumFromPath(
  filePath: string,
  fileSize: number,
  expectedChecksum: string | null
): Promise<{ verified: boolean; error?: Response }> {
  if (!expectedChecksum) {
    console.log(`⏭️  No checksum provided, skipping verification`);
    return { verified: false };
  }

  console.log(`🔐 Verifying file checksum...`);
  const actualChecksum = await calculateChecksumFromFile(filePath);
  if (actualChecksum === expectedChecksum) {
    console.log(`✅ Checksum verified: ${expectedChecksum.substring(0, 16)}...`);
    return { verified: true };
  }

  console.error(`❌ Checksum verification failed!`);
  return {
    verified: false,
    error: Response.json(
      {
        error: "Checksum verification failed",
        message:
          "File integrity check failed. The uploaded file may be corrupted.",
        expected: expectedChecksum,
        actual: actualChecksum,
        bufferSize: fileSize,
      },
      { status: 400 }
    ),
  };
}

/**
 * 验证请求的环境和 Token
 * Step 1: 检查环境是否存在
 * Step 2: 验证 Token 是否一致（使用环境级别或外层级别 Token）
 */
export function validateRequest(
  env: unknown,
  token: string | null,
  config: ServerConfig
): { valid: boolean; error?: string; envConfig?: EnvironmentConfig } {
  // 检查环境参数
  if (env == null || env === "") {
    return { valid: false, error: "Missing environment parameter" };
  }
  if (typeof env !== "string" || !env.trim()) {
    return { valid: false, error: "Invalid environment parameter" };
  }

  // Step 1: 检查环境是否存在
  if (!Object.hasOwn(config.environments, env)) {
    return { valid: false, error: `Unknown environment: ${env}` };
  }
  const envConfig = config.environments[env];

  // Step 2: 获取有效的 Token（优先使用环境级别，否则使用外层级别）
  const validToken = envConfig.token || config.token;
  if (!validToken) {
    return {
      valid: false,
      error: `No token configured for environment '${env}' (neither environment-level nor outer-level token found)`,
    };
  }

  // Step 3: 验证 Token
  if (!token) {
    return { valid: false, error: "Missing authorization token" };
  }

  if (!secureCompareStrings(token, validToken)) {
    return { valid: false, error: "Invalid token" };
  }

  return { valid: true, envConfig };
}
