#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "./config/loader";
import {
  handleUpload,
  handleDeploy,
  handleDeployStatus,
  handlePing,
  handleHealth,
  handleVerify,
} from "./routes/handlers";
import {
  handleUploadStatus,
  handleUploadInit,
  handleUploadChunk,
  handleUploadComplete,
  handleUploadCancel,
} from "./routes/chunkHandlers";
import { startCleanupScheduler } from "./services/chunkStorage";
import { VERSION } from "@/version";
import { checkAndUpdate } from "@/utils/selfUpdate";
import { uninstall } from "@/utils/selfUninstall";
import { logger } from "./utils/logger";
import { isDockerEnvironment } from "./utils/env";
import {
  clearAuthFailures,
  getAuthRetryAfter,
  recordAuthFailure,
} from "./services/validation";
import type { Server } from "bun";

type RouteHandler = (req: Request) => Response | Promise<Response>;

/**
 * 启动服务器
 * @param configPath 配置文件路径
 */
export async function startServer(configPath: string) {
  const config = await loadConfig(configPath);

  // 初始化日志文件（如果需要）
  // Daemon 模式下跳过 logger 初始化，因为 stdio 已经被重定向到文件
  const isDaemon = process.env.FDE_DAEMON_MODE === "true";

  if (!isDaemon) {
    const isDocker = isDockerEnvironment();

    if (isDocker) {
      // Docker 环境：固定日志路径，使用默认轮转配置
      const logPath = "/app/logs/fde-server.log";
      const maxSizeMB = config.log?.maxSize || 10;
      const maxBackups = config.log?.maxBackups || 5;

      await logger.init(logPath, {
        maxSize: maxSizeMB * 1024 * 1024,
        maxBackups,
      });

      console.log(chalk.blue(`🐳 Docker environment detected`));
      console.log(
        chalk.gray(
          `📄 Logs: ${logPath} (max: ${maxSizeMB}MB, backups: ${maxBackups})`
        )
      );
      console.log(
        chalk.gray(`💡 View logs: docker exec <container> cat ${logPath}`)
      );
      console.log(
        chalk.gray(`💡 Tail logs: docker exec <container> tail -f ${logPath}\n`)
      );
    } else if (config.log?.path) {
      // 非 Docker 环境：如果配置了日志路径，则使用配置的路径
      const { resolve } = await import("path");
      const logPath = resolve(process.cwd(), config.log.path);
      const maxSizeMB = config.log.maxSize || 10;
      const maxBackups = config.log.maxBackups || 5;

      await logger.init(logPath, {
        maxSize: maxSizeMB * 1024 * 1024,
        maxBackups,
      });

      console.log(
        chalk.gray(
          `📄 Logs: ${logPath} (max: ${maxSizeMB}MB, backups: ${maxBackups})`
        )
      );
    }
  }

  console.log(chalk.blue(`🚀 Server starting on port ${config.port}`));
  console.log(
    chalk.gray(
      `📋 Available environments: ${Object.keys(config.environments).join(
        ", "
      )}`
    )
  );

  let server: Server<any>;
  /** 给所有需要 Token 的路由统一增加按来源 IP 的失败限速。 */
  const withAuthRateLimit = (handler: RouteHandler): RouteHandler => {
    return async (req) => {
      // 部署文档要求 Nginx 重写 X-Real-IP；直连时回退到真实连接地址。
      const realIp = req.headers.get("x-real-ip")?.trim();
      const clientId =
        realIp || server.requestIP(req)?.address || "unknown";
      const retryAfter = getAuthRetryAfter(clientId);

      if (retryAfter > 0) {
        return Response.json(
          { error: "Too many authentication failures" },
          {
            status: 429,
            headers: { "Retry-After": retryAfter.toString() },
          }
        );
      }

      const response = await handler(req);
      // 只有认证失败才累计；成功认证后清除该来源的连续失败记录。
      if (response.status === 403) {
        recordAuthFailure(clientId);
      } else if (response.ok) {
        clearAuthFailures(clientId);
      }
      return response;
    };
  };

  server = Bun.serve({
    port: config.port,

    // 允许大文件上传 (默认是 128MB，这里设置为 1GB)
    maxRequestBodySize: 1024 * 1024 * 1024,

    // 设置最大 idle timeout (255秒，Bun 限制)，支持长时间运行的部署命令
    idleTimeout: 255,

    // 使用 Bun 官方路由语法
    // 路由按特异性顺序匹配：精确路由 > 参数路由 > 通配符路由 > 全局捕获
    routes: {
      // 精确路由 - 最具体的路由放在前面
      "/upload": {
        POST: withAuthRateLimit((req) => handleUpload(req, config)),
      },

      "/deploy": {
        POST: withAuthRateLimit((req) => handleDeploy(req, config)),
      },

      "/deploy/status": {
        GET: withAuthRateLimit((req) => handleDeployStatus(req, config)),
      },

      "/ping": {
        GET: () => handlePing(),
      },

      "/health": {
        GET: () => handleHealth(config),
      },

      "/verify": {
        POST: withAuthRateLimit((req) => handleVerify(req, config)),
      },

      // 分片上传路由
      "/upload/status": {
        GET: withAuthRateLimit((req) => handleUploadStatus(req, config)),
      },

      "/upload/init": {
        POST: withAuthRateLimit((req) => handleUploadInit(req, config)),
      },

      "/upload/chunk": {
        POST: withAuthRateLimit((req) => handleUploadChunk(req, config)),
      },

      "/upload/complete": {
        POST: withAuthRateLimit((req) => handleUploadComplete(req, config)),
      },

      "/upload/cancel": {
        DELETE: withAuthRateLimit((req) => handleUploadCancel(req, config)),
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
        },
        { status: 500 }
      );
    },
  });

  // 启动分片上传清理调度器
  startCleanupScheduler();

  console.log(
    chalk.green(`✅ Server is running at http://localhost:${server.port}`)
  );
  console.log(
    chalk.yellow(
      "🔒 Use plain HTTP only on a trusted private network; otherwise terminate TLS at a reverse proxy."
    )
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
  if (options.daemon && !isDockerEnvironment()) {
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
    const { rotateLogIfNeeded, getLogSize } = await import("./utils/logRotate");

    // 加载配置以获取日志设置
    const { loadConfig } = await import("./config/loader");
    const config = await loadConfig(options.config);

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

    // 构建参数（移除 -d 参数，保留 start 和其他参数）
    const args = process.argv
      .slice(2)
      .filter((arg) => arg !== "-d" && arg !== "--daemon");

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
    // 设置环境变量告诉子进程它是 daemon 模式，跳过 logger 初始化
    const child = spawn(execPath, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      cwd: cwd,
      env: {
        ...process.env,
        FDE_DAEMON_MODE: "true", // 标记 daemon 模式
      },
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
    // Docker 环境下忽略 daemon 参数
    if (isDockerEnvironment()) {
      console.log(
        chalk.yellow(
          `\n💡 Docker containers manage the process lifecycle automatically`
        )
      );
      console.log(
        chalk.yellow(
          `\n💡 Docker containers manage the process lifecycle automatically`
        )
      );
      console.log(
        chalk.yellow(`   Just run the container normally without -d flag\n`)
      );
    }

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
