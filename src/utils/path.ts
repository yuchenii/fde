import { resolve, isAbsolute } from "path";

/**
 * 路径解析上下文
 * 用于统一管理配置文件中的路径解析规则
 */
export interface PathContext {
  /** 配置文件所在目录（所有相对路径的锚点） */
  configDir: string;
  /** 是否 Docker 环境 */
  isDocker?: boolean;
  /** 宿主机配置目录（Docker 环境下，用于命令执行） */
  hostConfigDir?: string;
}

/**
 * 解析数据路径（用于 localPath, uploadPath, log.path 等）
 *
 * 规则：
 * - 绝对路径：原样返回
 * - Docker 环境：相对于容器工作目录 /app 解析
 * - 普通环境：相对于配置文件目录解析
 */
export function resolveDataPath(path: string, ctx: PathContext): string {
  if (isAbsolute(path)) return path;

  // Docker 环境：数据路径相对于容器工作目录
  if (ctx.isDocker) {
    return resolve("/app", path);
  }

  // 普通环境：相对于配置文件目录
  return resolve(ctx.configDir, path);
}

/**
 * 获取命令执行的基准目录
 *
 * 规则：
 * - Docker 环境：使用 hostConfigDir（宿主机配置目录）
 * - 普通环境：使用 configDir
 */
export function getCommandBaseDir(ctx: PathContext): string {
  if (ctx.isDocker && ctx.hostConfigDir) {
    return ctx.hostConfigDir;
  }
  return ctx.configDir;
}

/**
 * 解析命令中的脚本路径并确定工作目录
 *
 * 规则：所有命令都在 configDir 执行，保持一致性
 * - 这样脚本参数中的相对路径也能正确解析（如 ./scripts/deploy.sh ./dist）
 * - 脚本内部的相对路径也统一相对于项目根目录
 *
 * @param command 原始命令
 * @param ctx 路径上下文
 * @returns { command: 要执行的命令, cwd: 工作目录 }
 */
export function resolveCommandCwd(
  command: string,
  ctx: PathContext
): { command: string; cwd: string } {
  const trimmedCommand = command.trim();
  const baseDir = getCommandBaseDir(ctx);

  // 所有命令都在 configDir 执行，命令本身不做路径转换
  // 这样 ./scripts/deploy.sh ./dist 中的 ./dist 也能正确解析
  return { command: trimmedCommand, cwd: baseDir };
}
