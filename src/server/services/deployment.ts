import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import type { EnvironmentConfig } from "../types";

const execAsync = promisify(exec);

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

  console.log(`🚀 Executing deploy command: ${deployCommand}`);
  try {
    const { stdout, stderr } = await execAsync(deployCommand, {
      cwd: deployPath,
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
