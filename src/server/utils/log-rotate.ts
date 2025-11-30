import { statSync, renameSync, existsSync, unlinkSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";

/**
 * 日志轮转配置
 * 轮转时机：
 * 1. 启动 daemon 模式时
 * 2. 每次部署完成后
 */
interface LogRotateConfig {
  maxSize: number; // 最大文件大小（字节）
  maxBackups: number; // 保留的备份文件数量
}

const DEFAULT_CONFIG: LogRotateConfig = {
  maxSize: 10 * 1024 * 1024, // 10MB
  maxBackups: 5, // 保留5个备份
};

/**
 * 检查并轮转日志文件
 */
export function rotateLogIfNeeded(
  logPath: string,
  config: Partial<LogRotateConfig> = {}
): void {
  const { maxSize, maxBackups } = { ...DEFAULT_CONFIG, ...config };

  // 检查日志文件是否存在
  if (!existsSync(logPath)) {
    return;
  }

  try {
    // 获取文件大小
    const stats = statSync(logPath);

    // 如果文件大小超过限制，进行轮转
    if (stats.size >= maxSize) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .split(".")[0];
      const backupPath = `${logPath}.${timestamp}`;

      console.log(
        `📦 Log file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
      );
      console.log(`🔄 Rotating log file to: ${basename(backupPath)}`);

      // 重命名当前日志文件
      renameSync(logPath, backupPath);

      // 清理旧的备份文件
      cleanOldBackups(logPath, maxBackups);
    }
  } catch (error: any) {
    console.error(`⚠️  Failed to rotate log: ${error.message}`);
  }
}

/**
 * 清理旧的备份文件
 */
function cleanOldBackups(logPath: string, maxBackups: number): void {
  try {
    const dir = dirname(logPath);
    const logFileName = basename(logPath);

    // 查找所有备份文件
    const files = readdirSync(dir);
    const backups = files
      .filter((f) => f.startsWith(`${logFileName}.`))
      .map((f) => ({
        name: f,
        path: resolve(dir, f),
        time: statSync(resolve(dir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time); // 按时间降序排列

    // 删除超出数量的旧备份
    if (backups.length > maxBackups) {
      const toDelete = backups.slice(maxBackups);
      toDelete.forEach((backup) => {
        console.log(`🗑️  Deleting old backup: ${backup.name}`);
        unlinkSync(backup.path);
      });
    }
  } catch (error: any) {
    console.error(`⚠️  Failed to clean old backups: ${error.message}`);
  }
}

/**
 * 获取日志文件大小（人类可读格式）
 */
export function getLogSize(logPath: string): string {
  if (!existsSync(logPath)) {
    return "0 B";
  }

  try {
    const stats = statSync(logPath);
    const bytes = stats.size;

    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  } catch {
    return "Unknown";
  }
}
