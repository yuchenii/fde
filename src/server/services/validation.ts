import type { ServerConfig, EnvironmentConfig } from "../types";

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
