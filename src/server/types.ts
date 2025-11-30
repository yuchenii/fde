/**
 * 环境配置接口
 */
export interface EnvironmentConfig {
  token?: string; // Optional, falls back to outer-level token
  deployPath: string;
  deployCommand: string;
}

/**
 * 日志配置接口
 */
export interface LogConfig {
  path?: string; // 日志文件路径，默认 ./fde-server.log
  maxSize?: number; // 最大文件大小（MB），默认 10
  maxBackups?: number; // 保留备份数量，默认 5
}

/**
 * 服务器配置接口
 */
export interface ServerConfig {
  port: number;
  token?: string; // Outer-level token as fallback
  log?: LogConfig;
  environments: Record<string, EnvironmentConfig>;
}
