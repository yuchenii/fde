import { existsSync } from "fs";

/**
 * 检测是否在 Docker 环境中运行
 */
export function isDockerEnvironment(): boolean {
  try {
    return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
  } catch {
    return false;
  }
}
