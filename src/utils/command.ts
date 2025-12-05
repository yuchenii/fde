import { join, dirname, basename, isAbsolute } from "path";

/**
 * 检查命令是否以相对路径开头
 * 支持 Unix (./) 和 Windows (.\)
 */
function isRelativePath(command: string): boolean {
  return (
    command.startsWith("./") ||
    command.startsWith(".\\") ||
    command.startsWith("../") ||
    command.startsWith("..\\")
  );
}

/**
 * 解析命令中的脚本路径
 *
 * 规则：
 * 1. 命令以 ./ 或 ../ 或 .\ 或 ..\ 开头：视为脚本路径，相对于 basePath 解析，在脚本目录执行
 * 2. 命令是绝对路径（Unix: /xxx, Windows: C:\xxx）：视为绝对路径脚本，在脚本目录执行
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

  // 相对路径脚本：./xxx 或 ../xxx 或 .\xxx 或 ..\xxx
  if (isRelativePath(trimmedCommand)) {
    const fullPath = join(basePath, trimmedCommand);
    const scriptDir = dirname(fullPath);
    const scriptName = basename(fullPath);
    return { command: `./${scriptName}`, scriptDir };
  }

  // 绝对路径脚本：/xxx/xxx 或 C:\xxx\xxx
  if (isAbsolute(trimmedCommand)) {
    const scriptDir = dirname(trimmedCommand);
    const scriptName = basename(trimmedCommand);
    return { command: `./${scriptName}`, scriptDir };
  }

  // 其他命令：原样返回
  return { command: trimmedCommand, scriptDir: "" };
}
