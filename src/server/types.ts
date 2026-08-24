import type { EnvConfig } from "@/utils/env";

/**
 * 环境配置接口
 */
export interface EnvironmentConfig {
  token?: string; // Optional, falls back to outer-level token
  uploadPath: string;
  deployCommand: string;
  /** 环境变量配置 */
  env?: EnvConfig;
}

/**
 * 日志配置接口
 */
export interface LogConfig {
  path?: string; // 日志文件路径，默认 ./fde-server.log
  maxSize?: number; // 最大文件大小（MB），默认 10
  maxBackups?: number; // 保留备份数量，默认 5
}

/** 上传和 ZIP 解压限额，配置文件中的单位均为 MB。 */
export interface ServerLimitsConfig {
  chunkStorageMB?: number; // 所有新布局分片任务的预留容量，默认 10240
  chunkFileMB?: number; // 单个分片上传文件上限，默认等于 chunkStorageMB
  zipExtractMB?: number; // ZIP 解压后总大小上限，默认 2048
}

/**
 * 服务器配置接口
 */
export interface ServerConfig {
  port: number;
  token?: string; // Outer-level token as fallback
  log?: LogConfig;
  limits?: ServerLimitsConfig;
  /** 顶层环境变量配置（作为所有环境的默认值） */
  env?: EnvConfig;
  environments: Record<string, EnvironmentConfig>;
  configDir: string; // 配置文件所在目录（用于解析相对路径）
}
