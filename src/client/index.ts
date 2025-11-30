#!/usr/bin/env bun
import yaml from "js-yaml";
import { existsSync } from "fs";
import { loadConfig } from "./config/loader";
import { detectPathType } from "./utils/path";
import { runBuildCommand } from "./services/build";
import { checkServerConnection } from "./utils/server";
import { uploadFile, uploadDirectory } from "./services/upload";
import {
  uploadFileStream,
  uploadDirectoryStream,
} from "./services/stream-upload";
import { triggerDeploy } from "./services/deploy";
import type { ClientConfig } from "./types";
import { VERSION } from "../version";

/**
 * 主部署流程
 */
async function deploy(
  env: string,
  envConfig: ClientConfig["environments"][string]
) {
  console.log(`\n🎯 Starting deployment for environment: ${env}\n`);

  try {
    // 1. 验证 authToken 已配置
    if (!envConfig.authToken) {
      console.error(
        `\n❌ Error: Missing authentication token for environment '${env}'`
      );
      console.error(
        `   Please specify 'authToken' in the environment or 'token' at the outer level.`
      );
      process.exit(1);
    }

    // 2. 检查服务器连接
    const isServerReachable = await checkServerConnection(envConfig.serverUrl);
    if (!isServerReachable) {
      console.error(`\n💡 Please ensure the server is running and accessible.`);
      console.error(`   Server URL: ${envConfig.serverUrl}`);
      process.exit(1);
    }

    // 3. 执行构建命令
    if (envConfig.buildCommand) {
      await runBuildCommand(envConfig.buildCommand);
    }

    // 4. 验证本地路径存在
    if (!existsSync(envConfig.localPath)) {
      console.error(`\n❌ Error: Local path does not exist!`);
      console.error(`   Path: ${envConfig.localPath}`);
      console.error(
        `\n💡 Make sure the path is correct or the build command succeeded.`
      );
      process.exit(1);
    }

    // 5. 检测路径类型
    const pathType = await detectPathType(envConfig.localPath);
    console.log(`\n🔍 Detected path type: ${pathType.toUpperCase()}`);

    // 6. 根据路径类型选择上传方式（使用流式上传，支持进度条）
    let uploadResult;

    if (pathType === "directory") {
      // 目录：压缩后流式上传
      uploadResult = await uploadDirectoryStream(
        envConfig.localPath,
        envConfig.serverUrl,
        envConfig.authToken,
        env,
        envConfig.exclude || [],
        envConfig.skipChecksum || false
      );
    } else {
      // 单文件：流式上传
      uploadResult = await uploadFileStream(
        envConfig.localPath,
        envConfig.serverUrl,
        envConfig.authToken,
        env,
        envConfig.skipChecksum || false
      );
    }

    // 7. 触发部署
    const result = await triggerDeploy(envConfig.serverUrl, env);

    // 8. 显示结果
    console.log("\n📊 Deployment Result:");
    console.log(JSON.stringify(result, null, 2));
    console.log(`\n🎉 Deployment to '${env}' completed!`);
  } catch (error: any) {
    console.error(`\n💥 Deployment failed:`, error.message);
    process.exit(1);
  }
}

/**
 * CLI参数解析
 */
async function parseArgs(): Promise<{
  env: string;
  configPath: string;
  shouldStart: boolean;
}> {
  const args = process.argv.slice(2);
  let env = "";
  let configPath = "./deploy.yaml";

  // 检查帮助参数
  if (args.includes("-h") || args.includes("--help")) {
    showHelp();
    process.exit(0);
  }

  // 检查版本参数
  if (args.includes("-v") || args.includes("--version")) {
    showVersion();
    process.exit(0);
  }

  // 解析参数
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-e" || arg.startsWith("--env=")) {
      if (arg === "-e") {
        env = args[++i];
      } else {
        env = arg.split("=")[1];
      }
    } else if (arg === "-c") {
      configPath = args[++i];
    }
  }

  const shouldStart = args.includes("-s");

  // 如果没有 -s 参数，显示帮助信息
  if (!shouldStart) {
    showHelp();
    process.exit(0);
  }

  if (!env) {
    console.error("\n❌ Error: --env parameter is required");
    console.log("\n使用 --help 查看帮助信息\n");
    process.exit(1);
  }

  return { env, configPath, shouldStart };
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                       FDE Client                           ║
╚════════════════════════════════════════════════════════════╝

版本: ${VERSION}

用法:
  fde-client -s -e <environment> [选项]

选项:
  -s                 启动部署 (必需)
  -e, --env=<name>   指定部署环境 (必需)
  -c <path>          指定配置文件路径 (默认: ./deploy.yaml)
  -h, --help         显示此帮助信息
  -v, --version      显示版本信息

示例:
  fde-client -s -e prod                     # 部署到生产环境
  fde-client -s --env=test -c config.yaml   # 使用自定义配置

配置文件示例:
  # Optional: Outer-level token used when environment doesn't specify authToken
  token: "shared-secret-token"
  
  environments:
    prod:
      serverUrl: "http://your-server.com"
      authToken: "your-secret-token"  # Optional, overrides outer token
      localPath: "./dist"
      buildCommand: "npm run build"
`);
}

/**
 * 显示版本信息
 */
function showVersion() {
  console.log(`FDE Client v${VERSION}`);
}

/**
 * 主函数入口
 */
async function main() {
  try {
    const { env, configPath, shouldStart } = await parseArgs();

    // 检查是否有 -s 参数
    if (!shouldStart) {
      return;
    }

    // 加载配置
    const config = await loadConfig(configPath);

    // 获取环境配置
    const envConfig = config.environments[env];
    if (!envConfig) {
      console.error(`❌ Unknown environment: ${env}`);
      console.log(
        `\n💡 Available environments: ${Object.keys(config.environments).join(
          ", "
        )}`
      );
      process.exit(1);
    }

    // 执行部署
    await deploy(env, envConfig);
  } catch (error: any) {
    if (error.message && !error.message.includes("Failed to load config")) {
      console.error(`❌ Error:`, error.message);
    }
    process.exit(1);
  }
}

main();
