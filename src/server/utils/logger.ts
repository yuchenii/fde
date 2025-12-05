import { WriteStream, createWriteStream, existsSync, statSync } from "fs";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { rotateLogIfNeeded } from "./logRotate";

/**
 * 日志轮转配置
 */
interface LogRotateConfig {
  maxSize: number; // 最大文件大小（字节）
  maxBackups: number; // 保留的备份文件数量
}

/**
 * 自定义日志写入器
 */
class Logger {
  private logStream: WriteStream | null = null;
  private logFilePath: string | null = null;
  private rotateConfig: LogRotateConfig | null = null;
  private bytesWritten: number = 0;
  private checkInterval: number = 1000; // 每 1000 次写入检查一次
  private writeCount: number = 0;

  /**
   * 初始化日志文件
   */
  async init(logPath: string, rotateConfig?: LogRotateConfig) {
    this.logFilePath = logPath;
    this.rotateConfig = rotateConfig || null;

    // 确保日志目录存在
    const logDir = dirname(logPath);
    if (!existsSync(logDir)) {
      await mkdir(logDir, { recursive: true });
    }

    // 启动前先检查并轮转日志
    if (this.rotateConfig) {
      rotateLogIfNeeded(logPath, this.rotateConfig);
    }

    // 获取当前文件大小（如果文件存在）
    if (existsSync(logPath)) {
      try {
        const stats = statSync(logPath);
        this.bytesWritten = stats.size;
      } catch {
        this.bytesWritten = 0;
      }
    }

    // 创建写入流，追加模式
    this.logStream = createWriteStream(logPath, { flags: "a" });

    // 重写 console 方法
    this.overrideConsole();
  }

  /**
   * 检查是否需要轮转日志
   */
  private checkRotation() {
    if (!this.rotateConfig || !this.logFilePath) return;

    // 只在达到检查间隔时进行检查
    this.writeCount++;
    if (this.writeCount < this.checkInterval) return;

    this.writeCount = 0;

    // 检查文件大小
    if (this.bytesWritten >= this.rotateConfig.maxSize) {
      this.rotateLog();
    }
  }

  /**
   * 执行日志轮转
   */
  private rotateLog() {
    if (!this.logFilePath || !this.rotateConfig) return;

    try {
      // 关闭当前流
      this.logStream?.end();

      // 执行轮转
      rotateLogIfNeeded(this.logFilePath, this.rotateConfig);

      // 重新创建写入流
      this.logStream = createWriteStream(this.logFilePath, { flags: "a" });
      this.bytesWritten = 0;
    } catch (error: any) {
      console.error(`Failed to rotate log: ${error.message}`);
    }
  }

  /**
   * 重写 console 方法，同时输出到终端和文件
   */
  private overrideConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    // 格式化时间戳
    const timestamp = () => {
      return new Date()
        .toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          fractionalSecondDigits: 3,
          hour12: false,
        })
        .replace(/\//g, "-");
    };

    console.log = (...args: any[]) => {
      const message = `[${timestamp()}] [LOG] ${args.join(" ")}\n`;
      originalLog(...args);
      if (this.logStream) {
        this.logStream.write(message);
        this.bytesWritten += Buffer.byteLength(message);
        this.checkRotation();
      }
    };

    console.error = (...args: any[]) => {
      const message = `[${timestamp()}] [ERROR] ${args.join(" ")}\n`;
      originalError(...args);
      if (this.logStream) {
        this.logStream.write(message);
        this.bytesWritten += Buffer.byteLength(message);
        this.checkRotation();
      }
    };

    console.warn = (...args: any[]) => {
      const message = `[${timestamp()}] [WARN] ${args.join(" ")}\n`;
      originalWarn(...args);
      if (this.logStream) {
        this.logStream.write(message);
        this.bytesWritten += Buffer.byteLength(message);
        this.checkRotation();
      }
    };

    console.info = (...args: any[]) => {
      const message = `[${timestamp()}] [INFO] ${args.join(" ")}\n`;
      originalInfo(...args);
      if (this.logStream) {
        this.logStream.write(message);
        this.bytesWritten += Buffer.byteLength(message);
        this.checkRotation();
      }
    };
  }

  /**
   * 获取日志文件路径
   */
  getLogPath(): string | null {
    return this.logFilePath;
  }

  /**
   * 关闭日志流
   */
  close() {
    this.logStream?.end();
  }
}

// 全局单例
export const logger = new Logger();
