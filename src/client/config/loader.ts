import yaml from "js-yaml";
import { dirname, resolve } from "path";
import type { ClientConfig } from "../types";
import { resolveDataPath, type PathContext } from "@/utils/path";
import { mergeEnvConfig } from "@/utils/env";

/**
 * 读取客户端配置文件
 * 配置文件中的相对路径将相对于配置文件所在目录解析
 */
export async function loadConfig(configPath: string): Promise<ClientConfig> {
  try {
    const configFile = Bun.file(configPath);
    const configText = await configFile.text();
    const config = yaml.load(configText) as ClientConfig;

    if (!config.environments) {
      throw new Error("Invalid config: missing 'environments'");
    }

    // 创建路径上下文（客户端不在 Docker 环境）
    const configDir = dirname(resolve(configPath));
    const pathContext: PathContext = { configDir };

    // Merge outer-level defaults into environment configs
    const outerToken = config.token;
    const outerServerUrl = config.serverUrl;
    const outerEnv = config.env;

    for (const [envName, envConfig] of Object.entries(config.environments)) {
      // Merge serverUrl
      if (!envConfig.serverUrl) {
        if (outerServerUrl) {
          envConfig.serverUrl = outerServerUrl;
        } else {
          throw new Error(
            `Missing serverUrl for environment '${envName}': neither environment-level 'serverUrl' nor outer-level 'serverUrl' is specified`
          );
        }
      }

      // Merge token
      if (!envConfig.token) {
        if (outerToken) {
          envConfig.token = outerToken;
        } else {
          throw new Error(
            `Missing token for environment '${envName}': neither environment-level 'token' nor outer-level 'token' is specified`
          );
        }
      }

      // 使用统一路径解析
      if (envConfig.localPath) {
        envConfig.localPath = resolveDataPath(envConfig.localPath, pathContext);
      }

      // 合并环境变量配置（顶层 + 环境级）
      envConfig.env = mergeEnvConfig(outerEnv, envConfig.env);
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
