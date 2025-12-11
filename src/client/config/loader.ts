import yaml from "js-yaml";
import { dirname, resolve, isAbsolute } from "path";
import type { ClientConfig } from "../types";

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

    // 获取配置文件所在目录（用于解析相对路径）
    const configDir = dirname(resolve(configPath));

    // Merge outer-level defaults into environment configs
    const outerToken = config.token;
    const outerServerUrl = config.serverUrl;

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

      // Merge authToken
      if (!envConfig.authToken) {
        if (outerToken) {
          envConfig.authToken = outerToken;
        } else {
          throw new Error(
            `Missing token for environment '${envName}': neither environment-level 'authToken' nor outer-level 'token' is specified`
          );
        }
      }

      // 解析 localPath 中的相对路径
      if (envConfig.localPath && !isAbsolute(envConfig.localPath)) {
        envConfig.localPath = resolve(configDir, envConfig.localPath);
      }
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
