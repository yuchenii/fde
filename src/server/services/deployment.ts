import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import type { EnvironmentConfig } from "../types";

const execAsync = promisify(exec);

/**
 * 检测是否在 Docker 环境中运行
 */
function isDockerEnvironment(): boolean {
  try {
    return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
  } catch {
    return false;
  }
}

/**
 * 获取 SSH 执行命令
 * 如果配置了 SSH 环境变量，返回 SSH 命令和执行目录
 */
function getSshCommand(
  deployCommand: string,
  deployPath: string
): { command: string; cwd: string } {
  const sshHost = process.env.SSH_HOST;
  const sshUser = process.env.SSH_USER;
  const sshPort = process.env.SSH_PORT || "22";
  const hostProjectPath = process.env.HOST_PROJECT_PATH || "";
  const privateKeyPath = "/root/.ssh/id_rsa";

  console.log(`🐳 Docker environment detected, using SSH to execute on host`);

  // 处理路径：如果是相对路径，尝试拼接宿主机项目路径
  let hostCwd = deployPath;
  if (!deployPath.startsWith("/") && hostProjectPath) {
    // 移除可能的 ./ 前缀
    const cleanPath = deployPath.replace(/^\.\//, "");
    hostCwd = join(hostProjectPath, cleanPath);
  }

  // 处理 deployCommand 中的相对路径
  // 如果命令以 ./ 开头，且配置了宿主机项目路径，则将其解析为绝对路径
  // 这样用户可以在 server.yaml 中使用相对于项目根目录的路径，如 ./scripts/deploy.sh
  let finalDeployCommand = deployCommand;
  if (deployCommand.trim().startsWith("./") && hostProjectPath) {
    const cleanCommand = deployCommand.trim().replace(/^\.\//, "");
    finalDeployCommand = join(hostProjectPath, cleanCommand);
  }

  // 构建 SSH 命令
  // -o StrictHostKeyChecking=no 避免首次连接交互
  // -o UserKnownHostsFile=/dev/null 避免写入 known_hosts
  // -o IdentitiesOnly=yes 避免尝试所有 key 导致 Too many authentication failures
  // 先创建目录（如果不存在），然后进入目录执行命令
  const innerCommand = `mkdir -p '${hostCwd}' && cd '${hostCwd}' && ${finalDeployCommand}`;

  const command = `ssh -p ${sshPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -i ${privateKeyPath} ${sshUser}@${sshHost} "${innerCommand.replace(
    /"/g,
    '\\"'
  )}"`;

  // SSH 命令本身在容器内执行，不需要 cwd（默认是 /app）
  return { command, cwd: "/app" };
}

/**
 * 执行部署命令
 */
export async function executeDeployCommand(
  deployCommand: string,
  deployPath: string
): Promise<void> {
  if (!deployCommand) {
    return;
  }

  // 准备执行的命令
  let commandToExecute = deployCommand;
  let cwd = deployPath;

  if (isDockerEnvironment()) {
    if (!process.env.SSH_HOST || !process.env.SSH_USER) {
      throw new Error(
        "SSH_HOST and SSH_USER must be set in Docker environment"
      );
    }

    // 获取 SSH 命令
    const sshCommand = getSshCommand(deployCommand, deployPath);
    commandToExecute = sshCommand.command;
    cwd = sshCommand.cwd;
  } else {
    // 普通环境 需要处理 deployCommand 中的相对路径
    // 如果命令以 ./ 开头，将其解析为相对于当前工作目录（项目根目录）的绝对路径
    if (deployCommand.trim().startsWith("./")) {
      const cleanCommand = deployCommand.trim().replace(/^\.\//, "");
      commandToExecute = join(process.cwd(), cleanCommand);
    }
  }

  console.log(`🚀 Executing deploy command: ${commandToExecute}`);
  try {
    const { stdout, stderr } = await execAsync(commandToExecute, {
      cwd,
    });

    if (stdout) console.log("Command output:", stdout);
    if (stderr) console.error("Command stderr:", stderr);
    console.log(`✅ Deploy command completed`);
  } catch (error) {
    console.error(`❌ Deploy command failed:`, error);
    throw error;
  }
}

/**
 * 解压 zip 文件并部署
 */
export async function extractAndDeploy(
  zipBuffer: Buffer,
  fileName: string,
  envConfig: EnvironmentConfig,
  env: string
): Promise<void> {
  const deployPath = envConfig.deployPath;
  const tempZipPath = join("/tmp", `deploy-${env}-${Date.now()}.zip`);

  try {
    // 保存上传的 Zip 文件
    await Bun.write(tempZipPath, zipBuffer);
    console.log(`📦 Zip file saved to ${tempZipPath}`);

    // 确保部署目录存在
    if (!existsSync(deployPath)) {
      await mkdir(deployPath, { recursive: true });
      console.log(`📁 Created deploy directory: ${deployPath}`);
    }

    // 解压 Zip 文件
    console.log(`📂 Extracting to ${deployPath}...`);
    await execAsync(`unzip -o ${tempZipPath} -d ${deployPath}`);
    console.log(`✅ Files extracted successfully`);

    // 清理临时文件
    await rm(tempZipPath, { force: true });
  } catch (error) {
    console.error(`❌ Extraction failed:`, error);
    throw error;
  }
}

/**
 * 直接保存单个文件（不解压）
 */
export async function saveFile(
  fileBuffer: Buffer,
  fileName: string,
  envConfig: EnvironmentConfig,
  env: string
): Promise<void> {
  const deployPath = envConfig.deployPath;

  try {
    // 确保部署目录存在
    if (!existsSync(deployPath)) {
      await mkdir(deployPath, { recursive: true });
      console.log(`📁 Created deploy directory: ${deployPath}`);
    }

    // 保存文件
    const filePath = join(deployPath, fileName);
    await Bun.write(filePath, fileBuffer);
    console.log(`💾 File saved to: ${filePath}`);
    console.log(`📄 File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error(`❌ File save failed:`, error);
    throw error;
  }
}
