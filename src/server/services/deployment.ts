import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import type { EnvironmentConfig } from "../types";
import { isDockerEnvironment } from "../utils/env";
import { parseScriptCommand } from "@/utils/command";

const execAsync = promisify(exec);

/**
 * 获取 SSH 执行命令
 * 如果配置了 SSH 环境变量，返回 SSH 命令和执行目录
 *
 * 注意：uploadPath 和 configDir 已在 loader 中使用 HOST_CONFIG_DIR 转换为宿主机绝对路径
 */
function getSshCommand(
  deployCommand: string,
  uploadPath: string,
  configDir: string
): { command: string; cwd: string } {
  const sshHost = process.env.SSH_HOST;
  const sshUser = process.env.SSH_USER;
  const sshPort = process.env.SSH_PORT || "22";
  const privateKeyPath = "/root/.ssh/id_rsa";

  console.log(`🐳 Docker environment detected, using SSH to execute on host`);

  // 处理 deployCommand 中的相对路径
  // uploadPath 和 configDir 已是宿主机绝对路径
  const { command: finalDeployCommand, scriptDir } = parseScriptCommand(
    deployCommand,
    configDir
  );

  // 构建 SSH 命令
  // -o StrictHostKeyChecking=no 避免首次连接交互
  // -o UserKnownHostsFile=/dev/null 避免写入 known_hosts
  // -o IdentitiesOnly=yes 避免尝试所有 key 导致 Too many authentication failures
  // -o LogLevel=ERROR 只显示错误，隐藏警告信息（如首次添加known_hosts的警告）
  let innerCommand: string;
  if (scriptDir) {
    // 脚本文件：先 cd 到脚本目录，再执行脚本
    innerCommand = `mkdir -p '${uploadPath}' && cd '${scriptDir}' && ${finalDeployCommand}`;
  } else {
    // 普通命令：在 configDir（项目根目录）执行
    innerCommand = `mkdir -p '${uploadPath}' && cd '${configDir}' && ${finalDeployCommand}`;
  }

  const command = `ssh -p ${sshPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o LogLevel=ERROR -i ${privateKeyPath} ${sshUser}@${sshHost} "${innerCommand.replace(
    /"/g,
    '\\"'
  )}"`;

  // SSH 命令本身在容器内执行，不需要 cwd（默认是 /app）
  return { command, cwd: "/app" };
}

/**
 * 准备部署命令（提取公共逻辑）
 */
function prepareDeployCommand(
  deployCommand: string,
  uploadPath: string,
  configDir: string
): { command: string; cwd: string } {
  if (isDockerEnvironment()) {
    if (!process.env.SSH_HOST || !process.env.SSH_USER) {
      throw new Error(
        "SSH_HOST and SSH_USER must be set in Docker environment"
      );
    }
    return getSshCommand(deployCommand, uploadPath, configDir);
  } else {
    const { command, scriptDir } = parseScriptCommand(deployCommand, configDir);
    return {
      command,
      cwd: scriptDir || process.cwd(),
    };
  }
}

/**
 * 流式执行部署命令
 * @param deployCommand 部署命令
 * @param uploadPath 部署目录
 * @param configDir 配置文件所在目录
 * @param onData 数据回调函数，接收 type ('stdout'|'stderr') 和 data
 * @returns Promise，resolve 时返回 exit code
 */
export function executeDeployCommandStream(
  deployCommand: string,
  uploadPath: string,
  configDir: string,
  onData: (type: "stdout" | "stderr", data: string) => void
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!deployCommand) {
      resolve({ code: 0, stdout: "", stderr: "" });
      return;
    }

    const { command, cwd } = prepareDeployCommand(
      deployCommand,
      uploadPath,
      configDir
    );

    console.log(`🚀 Executing deploy command (stream): ${command}`);

    // 使用 shell 执行命令
    const child = spawn(command, [], {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      // 按行分别打日志，每行都有时间戳
      text
        .split("\n")
        .filter((line) => line)
        .forEach((line) => console.log(line));
      onData("stdout", text);
    });

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      // 按行分别打日志，每行都有时间戳
      text
        .split("\n")
        .filter((line) => line)
        .forEach((line) => console.error(line));
      onData("stderr", text);
    });

    child.on("close", (code) => {
      const exitCode = code ?? 0;
      if (exitCode === 0) {
        console.log(`✅ Deploy command completed (stream)`);
      } else {
        console.error(`❌ Deploy command failed with code ${exitCode}`);
      }
      resolve({ code: exitCode, stdout, stderr });
    });

    child.on("error", (err) => {
      console.error(`❌ Deploy command error:`, err);
      reject(err);
    });
  });
}

/**
 * 执行部署命令
 * @param deployCommand 部署命令
 * @param uploadPath 部署目录
 * @param configDir 配置文件所在目录（用于解析相对路径）
 * @returns 命令执行结果（stdout 和 stderr）
 */
export async function executeDeployCommand(
  deployCommand: string,
  uploadPath: string,
  configDir: string
): Promise<{ stdout: string; stderr: string }> {
  if (!deployCommand) {
    return { stdout: "", stderr: "" };
  }

  // 使用公共函数准备命令
  const { command: commandToExecute, cwd } = prepareDeployCommand(
    deployCommand,
    uploadPath,
    configDir
  );

  console.log(`🚀 Executing deploy command: ${commandToExecute}`);
  try {
    const { stdout, stderr } = await execAsync(commandToExecute, {
      cwd,
    });

    if (stdout) console.log("Command output:", stdout);
    if (stderr) console.error("Command stderr:", stderr);
    console.log(`✅ Deploy command completed`);
    return { stdout: stdout || "", stderr: stderr || "" };
  } catch (error: any) {
    console.error(`❌ Deploy command failed:`, error);
    // 创建包含详细输出的错误对象
    const detailedError = new Error(error.message || "Deploy command failed");
    (detailedError as any).stdout = error.stdout || "";
    (detailedError as any).stderr = error.stderr || "";
    (detailedError as any).code = error.code;
    throw detailedError;
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
  const uploadPath = envConfig.uploadPath;
  const tempZipPath = join("/tmp", `deploy-${env}-${Date.now()}.zip`);

  try {
    // 保存上传的 Zip 文件
    await Bun.write(tempZipPath, zipBuffer);
    console.log(`📦 Zip file saved to ${tempZipPath}`);

    // 确保部署目录存在
    if (!existsSync(uploadPath)) {
      await mkdir(uploadPath, { recursive: true });
      console.log(`📁 Created deploy directory: ${uploadPath}`);
    }

    // 解压 Zip 文件
    console.log(`📂 Extracting to ${uploadPath}...`);
    await execAsync(`unzip -o ${tempZipPath} -d ${uploadPath}`);
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
  const uploadPath = envConfig.uploadPath;

  try {
    // 确保部署目录存在
    if (!existsSync(uploadPath)) {
      await mkdir(uploadPath, { recursive: true });
      console.log(`📁 Created deploy directory: ${uploadPath}`);
    }

    // 保存文件
    const filePath = join(uploadPath, fileName);
    await Bun.write(filePath, fileBuffer);
    console.log(`💾 File saved to: ${filePath}`);
    console.log(`📄 File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error(`❌ File save failed:`, error);
    throw error;
  }
}
