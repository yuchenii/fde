#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "fs";
import { detectPathType } from "./utils/path";
import { runBuildCommand } from "./services/build";
import {
  checkServerConnection,
  checkServerHealth,
  verifyAuthToken,
} from "./utils/healthCheck";
import {
  uploadFileChunked,
  uploadDirectoryChunked,
} from "./services/chunkUpload";
import { triggerDeploy } from "./services/deploy";
import type { ClientConfig } from "./types";
import { VERSION } from "@/version";
import { checkAndUpdate } from "@/utils/selfUpdate";
import { uninstall } from "@/utils/selfUninstall";

/**
 * 主部署流程
 */
async function deploy(
  env: string,
  envConfig: ClientConfig["environments"][string],
  configDir: string,
  skipBuild: boolean = false,
  triggerOnly: boolean = false
) {
  console.log(chalk.blue(`\n🎯 Starting deployment for environment: ${env}\n`));
  if (triggerOnly) {
    console.log(
      chalk.yellow(`⚡ Trigger-only mode: Skipping build and upload`)
    );
  }

  try {
    // 1. 验证 authToken 已配置
    if (!envConfig.authToken) {
      console.error(
        chalk.red(
          `\n❌ Error: Missing authentication token for environment '${env}'`
        )
      );
      console.error(
        chalk.yellow(
          `   Please specify 'authToken' in the environment or 'token' at the outer level.`
        )
      );
      process.exit(1);
    }

    // 2. 检查服务器连接
    const isServerReachable = await checkServerConnection(envConfig.serverUrl);
    if (!isServerReachable) {
      console.error(
        chalk.yellow(`\n💡 Please ensure the server is running and accessible.`)
      );
      console.error(chalk.yellow(`   Server URL: ${envConfig.serverUrl}`));
      process.exit(1);
    }

    // 3. 验证 Token 是否正确（在 build 之前，避免 build 完成后才发现 token 错误）
    const tokenResult = await verifyAuthToken(
      envConfig.serverUrl,
      envConfig.authToken,
      env
    );
    if (!tokenResult.valid) {
      console.error(chalk.red(`\n❌ Error: Authentication failed`));
      console.error(chalk.red(`   ${tokenResult.error}`));
      console.error(
        chalk.yellow(
          `\n💡 Please check your authToken configuration and ensure it matches the server's token.`
        )
      );
      process.exit(1);
    }

    // 4. 执行构建命令
    if (!triggerOnly && !skipBuild && envConfig.buildCommand) {
      await runBuildCommand(envConfig.buildCommand, configDir);
    }

    // 5. 验证本地路径存在
    if (!triggerOnly) {
      if (!existsSync(envConfig.localPath)) {
        console.error(chalk.red(`\n❌ Error: Local path does not exist!`));
        console.error(chalk.red(`   Path: ${envConfig.localPath}`));
        console.error(
          chalk.yellow(
            `\n💡 Make sure the path is correct or the build command succeeded.`
          )
        );
        process.exit(1);
      }

      // 6. 检测路径类型
      const pathType = await detectPathType(envConfig.localPath);
      console.log(
        chalk.gray(`\n🔍 Detected path type: ${pathType.toUpperCase()}`)
      );

      // 7. 根据路径类型选择上传方式（使用分片上传，支持断点续传）
      if (pathType === "directory") {
        // 目录：压缩后分片上传
        await uploadDirectoryChunked(
          envConfig.localPath,
          envConfig.serverUrl,
          envConfig.authToken,
          env,
          envConfig.exclude || [],
          envConfig.skipChecksum || false
        );
      } else {
        // 单文件：分片上传
        await uploadFileChunked(
          envConfig.localPath,
          envConfig.serverUrl,
          envConfig.authToken,
          env,
          envConfig.skipChecksum || false
        );
      }
    }

    // 8. 触发部署
    const result = await triggerDeploy(
      envConfig.serverUrl,
      env,
      envConfig.authToken
    );

    // 9. 显示结果
    console.log(chalk.blue("\n📊 Deployment Result:"));
    console.log(JSON.stringify(result, null, 2));
    console.log(chalk.green(`\n🎉 Deployment to '${env}' completed!`));
  } catch (error: any) {
    console.error(chalk.red(`\n💥 Deployment failed:`), error.message);
    process.exit(1);
  }
}

/**
 * 处理部署命令
 */
async function handleDeployCommand(options: {
  env: string;
  config: string;
  skipBuild?: boolean;
  triggerOnly?: boolean;
}) {
  try {
    // 加载配置
    const { loadConfig } = await import("./config/loader");
    const config = await loadConfig(options.config);

    // 获取环境配置
    const envConfig = config.environments[options.env];
    if (!envConfig) {
      console.error(
        chalk.red(
          `\n❌ Error: Environment '${options.env}' not found in config file`
        )
      );
      console.error(
        chalk.gray(
          `   Available environments: ${Object.keys(config.environments).join(
            ", "
          )}`
        )
      );
      process.exit(1);
    }

    // 执行部署
    await deploy(
      options.env,
      envConfig,
      config.configDir,
      options.skipBuild,
      options.triggerOnly
    );
  } catch (error: any) {
    if (error.message && !error.message.includes("Failed to load config")) {
      console.error(chalk.red(`❌ Error:`), error.message);
    }
    process.exit(1);
  }
}

/**
 * 处理 Ping 命令
 */
async function handlePingCommand(options: {
  env?: string;
  server?: string;
  config: string;
}) {
  try {
    let serverUrl = options.server;

    // 如果没有直接指定 server，尝试从环境配置获取
    if (!serverUrl && options.env) {
      const { loadConfig } = await import("./config/loader");
      const config = await loadConfig(options.config);
      const envConfig = config.environments[options.env];
      if (envConfig) {
        serverUrl = envConfig.serverUrl;
      }
    }

    if (!serverUrl) {
      console.error(
        chalk.red(
          "\n❌ Error: Please specify a server URL via --server or an environment via --env"
        )
      );
      process.exit(1);
    }

    await checkServerConnection(serverUrl);
  } catch (error: any) {
    console.error(chalk.red(`❌ Error:`), error.message);
    process.exit(1);
  }
}

/**
 * 处理 Health 命令
 */
async function handleHealthCommand(options: {
  env?: string;
  server?: string;
  config: string;
}) {
  try {
    let serverUrl = options.server;

    // 如果没有直接指定 server，尝试从环境配置获取
    if (!serverUrl && options.env) {
      const { loadConfig } = await import("./config/loader");
      const config = await loadConfig(options.config);
      const envConfig = config.environments[options.env];
      if (envConfig) {
        serverUrl = envConfig.serverUrl;
      }
    }

    if (!serverUrl) {
      console.error(
        chalk.red(
          "\n❌ Error: Please specify a server URL via --server or an environment via --env"
        )
      );
      process.exit(1);
    }

    const health = await checkServerHealth(serverUrl);
    if (health) {
      console.log(chalk.green(`\n✅ Server is healthy`));
      console.log(JSON.stringify(health, null, 2));
    }
  } catch (error: any) {
    console.error(chalk.red(`❌ Error:`), error.message);
    process.exit(1);
  }
}

/**
 * 主函数入口
 */
async function main() {
  const program = new Command();

  program
    .name("fde-client")
    .description("Fast Deploy Engine Client")
    .version(VERSION);

  program
    .command("deploy")
    .description("Deploy project")
    .requiredOption("-e, --env <env>", "Environment name (e.g., prod, test)")
    .option("-c, --config <path>", "Config file path", "./deploy.yaml")
    .option("--skip-build", "Skip build command and upload files directly")
    .option("--trigger-only", "Trigger server deployment without build/upload")
    .action(handleDeployCommand);

  program
    .command("ping")
    .description("Check server connection")
    .option("-e, --env <env>", "Environment name")
    .option("-s, --server <url>", "Server URL")
    .option("-c, --config <path>", "Config file path", "./deploy.yaml")
    .action(handlePingCommand);

  program
    .command("health")
    .description("Check server health details")
    .option("-e, --env <env>", "Environment name")
    .option("-s, --server <url>", "Server URL")
    .option("-c, --config <path>", "Config file path", "./deploy.yaml")
    .action(handleHealthCommand);

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

main();
