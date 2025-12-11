import yaml from "js-yaml";
import { dirname, resolve, isAbsolute } from "path";
import type { ServerConfig } from "../types";
import { isDockerEnvironment } from "../utils/env";

/**
 * Docker 环境下的路径解析
 * - uploadPath: 相对于容器工作目录 (/app) 解析
 * - configDir: 使用 HOST_CONFIG_DIR，供 deployCommand 通过 SSH 在宿主机执行
 */
function resolveDockerPaths(
  config: ServerConfig,
  configFileDir: string
): ServerConfig {
  for (const env of Object.values(config.environments)) {
    if (env.uploadPath && !isAbsolute(env.uploadPath)) {
      env.uploadPath = resolve("/app", env.uploadPath);
    }
  }
  if (config.log?.path && !isAbsolute(config.log.path)) {
    config.log.path = resolve("/app", config.log.path);
  }
  config.configDir = process.env.HOST_CONFIG_DIR || configFileDir;
  return config;
}

/**
 * 在运行时读取并解析 YAML 配置文件
 * 配置文件中的相对路径将相对于配置文件所在目录解析
 */
export async function loadConfig(configPath: string): Promise<ServerConfig> {
  try {
    const configFile = Bun.file(configPath);
    const configText = await configFile.text();
    const config = yaml.load(configText) as ServerConfig;

    // 验证配置结构
    if (!config.port || !config.environments) {
      throw new Error("Invalid config: missing 'port' or 'environments'");
    }

    // 配置文件所在目录
    const configDir = dirname(resolve(configPath));

    // Docker 环境使用单独的路径解析逻辑
    if (isDockerEnvironment()) {
      return resolveDockerPaths(config, configDir);
    }

    // 非 Docker 环境：所有路径相对于配置文件目录解析
    for (const env of Object.values(config.environments)) {
      if (env.uploadPath && !isAbsolute(env.uploadPath)) {
        env.uploadPath = resolve(configDir, env.uploadPath);
      }
    }

    // 解析 log.path 中的相对路径
    if (config.log?.path && !isAbsolute(config.log.path)) {
      config.log.path = resolve(configDir, config.log.path);
    }

    // 将 configDir 添加到配置中，供后续命令执行使用
    config.configDir = configDir;

    return config;
  } catch (error) {
    const errorMessage = `Failed to load config from ${configPath}`;
    console.error(`❌ ${errorMessage}:`, error);
    throw new Error(errorMessage, { cause: error });
  }
}
