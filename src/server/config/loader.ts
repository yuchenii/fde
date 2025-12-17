import yaml from "js-yaml";
import { dirname, resolve } from "path";
import type { ServerConfig } from "../types";
import { isDockerEnvironment } from "../utils/env";
import { resolveDataPath, type PathContext } from "@/utils/path";

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
    const configFileDir = dirname(resolve(configPath));
    const isDocker = isDockerEnvironment();

    // Docker 环境必须配置 HOST_CONFIG_DIR
    if (isDocker && !process.env.HOST_CONFIG_DIR) {
      throw new Error(
        "HOST_CONFIG_DIR environment variable is required in Docker environment. " +
          "This should be the absolute path to the config directory on the host machine."
      );
    }

    // 创建路径上下文
    const pathContext: PathContext = {
      configDir: configFileDir,
      isDocker,
      hostConfigDir: process.env.HOST_CONFIG_DIR,
    };

    // 解析环境配置中的路径
    for (const env of Object.values(config.environments)) {
      if (env.uploadPath) {
        env.uploadPath = resolveDataPath(env.uploadPath, pathContext);
      }
    }

    // 解析日志路径
    if (config.log?.path) {
      config.log.path = resolveDataPath(config.log.path, pathContext);
    }

    // configDir 用于命令执行：Docker 环境使用宿主机路径，普通环境使用配置目录
    config.configDir = isDocker ? process.env.HOST_CONFIG_DIR! : configFileDir;

    return config;
  } catch (error) {
    const errorMessage = `Failed to load config from ${configPath}`;
    console.error(`❌ ${errorMessage}:`, error);
    throw new Error(errorMessage, { cause: error });
  }
}
