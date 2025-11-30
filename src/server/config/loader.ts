import yaml from "js-yaml";
import type { ServerConfig } from "../types";

/**
 * 在运行时读取并解析 YAML 配置文件
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

    return config;
  } catch (error) {
    const errorMessage = `Failed to load config from ${configPath}`;
    console.error(`❌ ${errorMessage}:`, error);
    throw new Error(errorMessage, { cause: error });
  }
}
