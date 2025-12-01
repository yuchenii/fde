#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "./config/loader";
import {
  handleUpload,
  handleDeploy,
  handlePing,
  handleHealth,
} from "./routes/handlers";
import { handleUploadStream } from "./routes/stream-handlers";
import { VERSION } from "../version";
import { checkAndUpdate } from "../utils/self-update";
import { uninstall } from "../utils/self-uninstall";

/**
 * 启动服务器
 */
export async function startServer(configPath: string) {
  const config = await loadConfig(configPath);

  console.log(chalk.blue(`🚀 Server starting on port ${config.port}`));
  console.log(
    chalk.gray(
      `📋 Available environments: ${Object.keys(config.environments).join(
        ", "
      )}`
    )
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
      console.error(chalk.red("❌ Unhandled error:"), error);
      return Response.json(
        {
          error: "Internal server error",
          details: error.message,
        },
        { status: 500 }
      );
    },
  });

  console.log(
    chalk.green(`✅ Server is running at http://localhost:${server.port}`)
  );
  return server;
}

/**
 * 主函数入口
 */
/**
 * 处理启动命令
 */
async function handleStartCommand(options: {
  daemon?: boolean;
  config: string;
}) {
  // Daemon 模式 - 后台运行（仅 Unix/Linux/macOS）
  if (options.daemon) {
    // 检查操作系统
    if (process.platform === "win32") {
      console.error(chalk.red(`\n❌ Daemon mode is not supported on Windows`));
      console.log(chalk.yellow(`\n💡 Alternative options:`));
      console.log(`   1. Run in foreground: fde-server start`);
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
    const config = await loadConfig(options.config);

    // 构建参数（移除 -d 参数，保留 start 和其他参数）
    // 注意：这里我们需要重新构建传递给子进程的参数
    // 原始参数可能是: bun src/server/index.ts start -d -c config.yaml
    // 我们需要: bun src/server/index.ts start -c config.yaml
    const args = process.argv
      .slice(2)
      .filter((arg) => arg !== "-d" && arg !== "--daemon");

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

    console.log(chalk.blue(`🚀 Starting daemon process...`));
    console.log(chalk.gray(`📂 Executable: ${execPath}`));
    console.log(chalk.gray(`📂 Working directory: ${cwd}`));
    console.log(chalk.gray(`📋 Args: ${args.join(" ")}`));
    console.log(chalk.gray(`📄 Log file: ${logFile}`));
    console.log(chalk.gray(`📄 Current log size: ${currentLogSize}`));
    console.log(
      chalk.gray(`📊 Max size: ${maxSizeMB} MB, Max backups: ${maxBackups}`)
    );

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
      console.error(chalk.red(`❌ Failed to start daemon: ${err.message}`));
      process.exit(1);
    });

    // 短暂等待确保子进程启动
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 保存 PID
    if (child.pid) {
      writeFileSync(pidFile, child.pid.toString());

      // 分离子进程
      child.unref();

      console.log(chalk.green(`\n✅ Server started in daemon mode`));
      console.log(`📝 PID: ${child.pid}`);
      console.log(`📄 PID file: ${pidFile}`);
      console.log(chalk.yellow(`\n💡 停止服务: kill $(cat ${pidFile})`));
      console.log(chalk.yellow(`💡 查看日志: tail -f ${logFile}`));

      process.exit(0);
    } else {
      console.error(chalk.red(`❌ Failed to get child process PID`));
      process.exit(1);
    }
  } else {
    // 普通模式 - 前台运行
    await startServer(options.config);
  }
}

/**
 * 主函数入口
 */
async function main() {
  const program = new Command();

  program
    .name("fde-server")
    .description("Fast Deploy Engine Server")
    .version(VERSION);

  program
    .command("start")
    .description("Start the server")
    .option("-d, --daemon", "Run server in daemon mode (Unix/Linux/macOS only)")
    .option("-c, --config <path>", "Config file path", "./server.yaml")
    .action(handleStartCommand);

  program
    .command("upgrade")
    .description("Check for updates")
    .action(async () => {
      await checkAndUpdate();
    });

  program
    .command("uninstall")
    .description("Uninstall FDE")
    .action(async () => {
      await uninstall();
    });

  program.parse(process.argv);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(chalk.red("❌ Fatal error:"), error.message);
    process.exit(1);
  });
}
