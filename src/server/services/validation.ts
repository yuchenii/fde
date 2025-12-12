import type { ServerConfig, EnvironmentConfig } from "../types";
import { verifyChecksum, calculateChecksum } from "@/utils/checksum";

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

/**
 * 验证请求的环境和 Token
 * Step 1: 检查环境是否存在
 * Step 2: 验证 Token 是否一致（使用环境级别或外层级别 Token）
 */
export function validateRequest(
  env: string | null,
  authToken: string | null,
  config: ServerConfig
): { valid: boolean; error?: string; envConfig?: EnvironmentConfig } {
  // 检查环境参数
  if (!env) {
    return { valid: false, error: "Missing environment parameter" };
  }

  // Step 1: 检查环境是否存在
  const envConfig = config.environments[env];
  if (!envConfig) {
    return { valid: false, error: `Unknown environment: ${env}` };
  }

  // Step 2: 获取有效的 Token（优先使用环境级别，否则使用外层级别）
  const validToken = envConfig.token || config.token;
  if (!validToken) {
    return {
      valid: false,
      error: `No token configured for environment '${env}' (neither environment-level nor outer-level token found)`,
    };
  }

  // Step 3: 验证 Token
  if (!authToken) {
    return { valid: false, error: "Missing authorization token" };
  }

  if (authToken !== validToken) {
    return { valid: false, error: "Invalid token" };
  }

  return { valid: true, envConfig };
}
