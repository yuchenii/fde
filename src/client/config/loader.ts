import yaml from "js-yaml";
import type { ClientConfig } from "../types";

/**
 * 读取客户端配置文件
 */
export async function loadConfig(configPath: string): Promise<ClientConfig> {
  try {
    const configFile = Bun.file(configPath);
    const configText = await configFile.text();
    const config = yaml.load(configText) as ClientConfig;

    if (!config.environments) {
      throw new Error("Invalid config: missing 'environments'");
    }

    // Merge tokens: use outer-level token as fallback for environments
    const outerToken = config.token;
    for (const [envName, envConfig] of Object.entries(config.environments)) {
      if (!envConfig.authToken) {
        if (outerToken) {
          envConfig.authToken = outerToken;
        } else {
          throw new Error(
            `Missing token for environment '${envName}': neither environment-level 'authToken' nor outer-level 'token' is specified`
          );
        }
      }
    }

    return config;
  } catch (error) {
    const errorMessage = `Failed to load config from ${configPath}`;
    console.error(`❌ ${errorMessage}:`, error);
    throw new Error(errorMessage, { cause: error });
  }
}
