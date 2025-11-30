#!/usr/bin/env bun
import { loadConfig } from "./config/loader";
import {
  handleUpload,
  handleDeploy,
  handlePing,
  handleHealth,
} from "./routes/handlers";
import { handleUploadStream } from "./routes/stream-handlers";

/**
 * CLI参数解析
 */
function parseArgs(): {
  configPath: string;
  startServer: boolean;
  daemon: boolean;
} {
  const args = process.argv.slice(2);
  let configPath = "./server.yaml"; // 默认配置文件路径

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-h" || args[i] === "--help") {
      console.log(`
╔════════════════════════════════════════════════════════════╗
║                    FDE Server                            ║
╚════════════════════════════════════════════════════════════╝

版本: 1.0.0

用法:
  fde-server -s [选项]

选项:
  -s                启动服务器 (必需，防止误触)
  -c <path>         指定配置文件路径 (默认: ./server.yaml)
  -h, --help        显示此帮助信息

示例:
  fde-server -s                          # 使用默认配置启动
  fde-server -s -c /etc/deploy.yaml      # 指定配置文件启动

API 端点:
  POST /upload         文件上传接口
  POST /upload-stream  流式上传接口 (支持进度)
  POST /deploy         执行部署命令
  GET  /ping           连接测试
  GET  /health         健康检查

配置文件示例:
  port: 3000
  environments:
    prod:
      token: "your-secret-token"
      deployPath: "/var/www/html"
      deployCommand: "nginx -s reload"
`);
      process.exit(0);
    }

    if (args[i] === "-c" && i + 1 < args.length) {
      configPath = args[i + 1];
      i++;
    }
  }

  const startServer = args.includes("-s");
  const daemon = args.includes("-d");
  return { configPath, startServer, daemon };
}

/**
 * 启动服务器
 */
/**
 * 启动服务器
 */
export async function startServer(configPath: string) {
  const config = await loadConfig(configPath);

  console.log(`🚀 Server starting on port ${config.port}`);
  console.log(
    `📋 Available environments: ${Object.keys(config.environments).join(", ")}`
  );

  const server = Bun.serve({
    port: config.port,

    // 使用 Bun 官方路由语法
    // 路由按特异性顺序匹配：精确路由 > 参数路由 > 通配符路由 > 全局捕获
    routes: {
      // 精确路由 - 最具体的路由放在前面
      "/upload-stream": {
        POST: async (req: Request) => handleUploadStream(req, config),
      },

      "/upload": {
        POST: async (req: Request) => handleUpload(req, config),
      },

      "/deploy": {
        POST: async (req: Request) => handleDeploy(req, config),
      },

      "/ping": {
        GET: () => handlePing(),
      },

      "/health": {
        GET: () => handleHealth(config),
      },

      // 全局捕获 - 404 兜底，处理所有未匹配的路由
      "/*": () => {
        return Response.json(
          {
            error: "Not Found",
            message: "The requested endpoint does not exist",
          },
          { status: 404 }
        );
      },
    },

    // 错误处理
    error(error) {
      console.error("❌ Unhandled error:", error);
      return Response.json(
        {
          error: "Internal server error",
          details: error.message,
        },
        { status: 500 }
      );
    },
  });

  console.log(`✅ Server is running at http://localhost:${server.port}`);
  return server;
}

/**
 * 主函数入口
 */
async function main() {
  const { configPath, startServer: shouldStart, daemon } = parseArgs();

  // 检查是否有 -s 参数
  if (!shouldStart) {
    // 显示帮助信息
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    FDE Server                            ║
╚════════════════════════════════════════════════════════════╝

版本: 1.0.0

用法:
  fde-server -s [选项]

选项:
  -s                启动服务器 (必需)
  -d                后台运行 (daemon模式)
  -c <path>         指定配置文件路径 (默认: ./server.yaml)
  -h, --help        显示此帮助信息

示例:
  fde-server -s                          # 前台启动
  fde-server -s -d                       # 后台启动
  fde-server -s -d -c /etc/deploy.yaml   # 后台启动并指定配置

API 端点:
  POST /upload         文件上传接口
  POST /upload-stream  流式上传接口 (支持进度)
  POST /deploy         执行部署命令
  GET  /ping           连接测试
  GET  /health         健康检查

配置文件示例:
  port: 3000
  environments:
    prod:
      token: "your-secret-token"
      deployPath: "/var/www/html"
      deployCommand: "nginx -s reload"
`);
    process.exit(0);
  }

  // Daemon 模式 - 后台运行（仅 Unix/Linux/macOS）
  if (daemon) {
    // 检查操作系统
    if (process.platform === "win32") {
      console.error(`\n❌ Daemon mode is not supported on Windows`);
      console.log(`\n💡 Alternative options:`);
      console.log(`   1. Run in foreground: fde-server -s`);
      console.log(`   2. Use Windows Task Scheduler for background service`);
      console.log(`   3. Use pm2 or similar process manager\n`);
      process.exit(1);
    }

    const { spawn } = await import("child_process");
    const { writeFileSync, openSync, closeSync } = await import("fs");
    const { resolve } = await import("path");
    const { rotateLogIfNeeded, getLogSize } = await import(
      "./utils/log-rotate"
    );

    // 加载配置以获取日志设置
    const { loadConfig } = await import("./config/loader");
    const config = await loadConfig(configPath);

    // 构建参数（移除 -d 参数）
    const args = process.argv.slice(2).filter((arg) => arg !== "-d");

    // 从配置获取日志设置（带默认值）
    const cwd = process.cwd();
    const logPath = config.log?.path || "./fde-server.log";
    const logFile = resolve(cwd, logPath);
    const pidFile = resolve(cwd, "fde-server.pid");
    const maxSizeMB = config.log?.maxSize || 10;
    const maxBackups = config.log?.maxBackups || 5;

    // 检查并轮转日志文件
    rotateLogIfNeeded(logFile, {
      maxSize: maxSizeMB * 1024 * 1024,
      maxBackups: maxBackups,
    });

    // 获取当前日志文件大小
    const currentLogSize = getLogSize(logFile);

    // 获取当前执行文件的路径
    const execPath = process.execPath;

    console.log(`🚀 Starting daemon process...`);
    console.log(`📂 Executable: ${execPath}`);
    console.log(`📂 Working directory: ${cwd}`);
    console.log(`📋 Args: ${args.join(" ")}`);
    console.log(`📄 Log file: ${logFile}`);
    console.log(`📄 Current log size: ${currentLogSize}`);
    console.log(`📊 Max size: ${maxSizeMB} MB, Max backups: ${maxBackups}`);

    // 预先创建或打开日志文件
    const logFd = openSync(logFile, "a");

    // Fork 子进程，直接将 stdio 重定向到文件
    const child = spawn(execPath, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      cwd: cwd,
    });

    // 关闭父进程中的文件描述符
    closeSync(logFd);

    // 监听子进程错误
    child.on("error", (err) => {
      console.error(`❌ Failed to start daemon: ${err.message}`);
      process.exit(1);
    });

    // 短暂等待确保子进程启动
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 保存 PID
    if (child.pid) {
      writeFileSync(pidFile, child.pid.toString());

      // 分离子进程
      child.unref();

      console.log(`\n✅ Server started in daemon mode`);
      console.log(`📝 PID: ${child.pid}`);
      console.log(`📄 PID file: ${pidFile}`);
      console.log(`\n💡 停止服务: kill $(cat ${pidFile})`);
      console.log(`💡 查看日志: tail -f ${logFile}`);

      process.exit(0);
    } else {
      console.error(`❌ Failed to get child process PID`);
      process.exit(1);
    }
  }

  // 普通模式 - 前台运行
  await startServer(configPath);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Fatal error:", error.message);
    process.exit(1);
  });
}
