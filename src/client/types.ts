/**
 * 环境配置接口
 */
export interface EnvironmentConfig {
  serverUrl: string;
  authToken?: string; // Optional, falls back to outer-level token
  localPath: string;
  buildCommand?: string;
  exclude?: string[];
  skipChecksum?: boolean; // 跳过文件完整性校验
}

/**
 * 客户端配置接口
 */
export interface ClientConfig {
  token?: string; // Outer-level token as fallback
  environments: Record<string, EnvironmentConfig>;
}
