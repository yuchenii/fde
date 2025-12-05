import { join, dirname } from "path";

/**
 * 解析命令中的脚本路径
 *
 * 规则：
 * 1. 命令以 ./ 或 ../ 开头：视为脚本路径，相对于 basePath 解析，在脚本目录执行
 * 2. 命令以 / 开头：视为绝对路径脚本，在脚本目录执行
 * 3. 其他命令：原样返回，scriptDir 为空（调用方决定执行目录）
 *
 * @param command 原始命令
 * @param basePath 基础路径（用于解析相对路径脚本）
 * @returns { command: 要执行的命令, scriptDir: 脚本所在目录（如果有） }
 */
export function parseScriptCommand(
  command: string,
  basePath: string
): { command: string; scriptDir: string } {
  const trimmedCommand = command.trim();

  // 相对路径脚本：./xxx 或 ../xxx
  if (trimmedCommand.startsWith("./") || trimmedCommand.startsWith("../")) {
    const fullPath = join(basePath, trimmedCommand);
    const scriptDir = dirname(fullPath);
    const scriptName = fullPath.substring(fullPath.lastIndexOf("/") + 1);
    return { command: `./${scriptName}`, scriptDir };
  }

  // 绝对路径脚本：/xxx/xxx
  if (trimmedCommand.startsWith("/")) {
    const scriptDir = dirname(trimmedCommand);
    const scriptName = trimmedCommand.substring(
      trimmedCommand.lastIndexOf("/") + 1
    );
    return { command: `./${scriptName}`, scriptDir };
  }

  // 其他命令：原样返回
  return { command: trimmedCommand, scriptDir: "" };
}
