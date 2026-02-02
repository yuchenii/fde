import type { EnvConfig } from "@/utils/env";

/**
 * 环境配置接口
 */
export interface EnvironmentConfig {
  serverUrl: string; // Required after merging with outer-level serverUrl
  token?: string; // Optional, falls back to outer-level token
  localPath: string;
  buildCommand?: string;
  exclude?: string[];
  /** 环境变量配置 */
  env?: EnvConfig;
}

/**
 * 客户端配置接口
 */
export interface ClientConfig {
  token?: string; // Outer-level token as fallback
  serverUrl?: string; // Outer-level serverUrl as fallback
  /** 顶层环境变量配置（作为所有环境的默认值） */
  env?: EnvConfig;
  environments: Record<string, EnvironmentConfig>;
  configDir: string; // 配置文件所在目录（用于解析相对路径）
}
