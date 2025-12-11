import yaml from "js-yaml";
import { dirname, resolve, isAbsolute } from "path";
import type { ServerConfig } from "../types";
import { isDockerEnvironment } from "../utils/env";

/**
 * 在运行时读取并解析 YAML 配置文件
 * 配置文件中的相对路径将相对于配置文件所在目录解析
 *
 * Docker 环境下使用 HOST_CONFIG_DIR 作为基础路径，
 * 因为路径需要在宿主机上执行
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

    // 确定基础路径：Docker 环境使用宿主机路径，普通环境使用配置文件目录
    const isDocker = isDockerEnvironment();
    const configDir = isDocker
      ? process.env.HOST_CONFIG_DIR || dirname(resolve(configPath))
      : dirname(resolve(configPath));

    // 解析 environments 中的相对路径
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
