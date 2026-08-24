import { join, basename, resolve, sep } from "path";
import { copyFile, lstat, mkdir, mkdtemp, rm, stat } from "fs/promises";
import { existsSync } from "fs";
import { exec, execFile, spawn } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import type { EnvironmentConfig, ServerLimitsConfig } from "../types";
import { resolveServerLimits } from "../config/limits";
import { isDockerEnvironment } from "../utils/env";
import { resolveCommandCwd, type PathContext } from "@/utils/path";
import { buildEnv, type EnvConfig } from "@/utils/env";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const DEFAULT_LIMITS = resolveServerLimits();
const MAX_EXTRACT_SIZE = DEFAULT_LIMITS.zipExtractBytes;
// 条目数是固定的内部防护；用户可配置的是解压后总字节数。
const MAX_ZIP_ENTRIES = 100_000;
// unzip 清单本身也必须受限，避免超长文件名先占满进程内存。
const MAX_ZIP_LISTING_BYTES = 64 * 1024 * 1024;

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

  // 使用统一的路径解析（Docker 环境，通过 SSH 在宿主机执行）
  const pathContext: PathContext = {
    configDir,
    isDocker: true,
    hostConfigDir: configDir, // configDir 已经是宿主机路径
  };
  const { command: finalDeployCommand, cwd: scriptCwd } = resolveCommandCwd(
    deployCommand,
    pathContext
  );

  // uploadPath 是容器路径（/app/deploy-packages/...），需要转换为宿主机路径
  // 通过将 /app 前缀替换为宿主机配置目录（configDir 已经是 HOST_CONFIG_DIR）
  const hostUploadPath = uploadPath.startsWith("/app/")
    ? join(configDir, uploadPath.slice("/app/".length))
    : uploadPath.startsWith("/app")
      ? configDir
      : uploadPath;

  // 构建 SSH 命令
  // -o StrictHostKeyChecking=no 避免首次连接交互
  // -o UserKnownHostsFile=/dev/null 避免写入 known_hosts
  // -o IdentitiesOnly=yes 避免尝试所有 key 导致 Too many authentication failures
  // -o LogLevel=ERROR 只显示错误，隐藏警告信息（如首次添加known_hosts的警告）
  const innerCommand = `mkdir -p '${hostUploadPath}' && cd '${scriptCwd}' && ${finalDeployCommand}`;

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
    // 非 Docker 环境：使用统一的路径解析
    const pathContext: PathContext = { configDir };
    return resolveCommandCwd(deployCommand, pathContext);
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
  onData: (type: "stdout" | "stderr", data: string) => void,
  envConfig?: EnvConfig
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

    // 构建子进程环境变量
    const env = buildEnv(envConfig);

    // 使用 shell 执行命令
    const child = spawn(command, [], {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
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
  configDir: string,
  envConfig?: EnvConfig
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

  // 构建子进程环境变量
  const env = buildEnv(envConfig);

  console.log(`🚀 Executing deploy command: ${commandToExecute}`);
  try {
    const { stdout, stderr } = await execAsync(commandToExecute, {
      cwd,
      env,
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
 * 校验 zip 条目路径不会逃逸出目标目录（防止 Zip Slip）
 */
export function assertSafeZipEntries(
  entries: string[],
  baseDir: string
): void {
  const baseResolved = resolve(baseDir);
  const basePrefix = baseResolved.endsWith(sep)
    ? baseResolved
    : baseResolved + sep;

  for (const entry of entries) {
    if (!entry) continue;
    const normalized = entry.replace(/\\/g, "/");
    if (normalized.split("/").includes("..")) {
      throw new Error(
        `Zip entry contains unsafe path: ${entry}. Possible Zip Slip attack.`
      );
    }
    const resolved = resolve(baseResolved, normalized);

    if (resolved !== baseResolved && !resolved.startsWith(basePrefix)) {
      throw new Error(
        `Zip entry contains unsafe path: ${entry}. Possible Zip Slip attack.`
      );
    }
  }
}

/**
 * 解析 unzip 的详细清单，拒绝链接/特殊文件，并限制条目数和解压大小。
 */
export function assertSafeZipEntryTypes(
  listing: string,
  maxBytes: number = MAX_EXTRACT_SIZE
): void {
  const declaredEntries = listing.match(/number of entries:\s*(\d+)/i);
  if (declaredEntries && Number(declaredEntries[1]) > MAX_ZIP_ENTRIES) {
    throw new Error("Zip archive exceeds the entry limit");
  }

  let entries = 0;
  let uncompressedBytes = 0;

  for (const line of listing.split("\n")) {
    const entry = line.match(
      /^([?bcdlps-])[rwxStTs-]{9}\s+\S+\s+\S+\s+(\d+)\s/
    );
    if (!entry) continue;

    const type = entry[1];
    if (type !== "?" && type !== "-" && type !== "d") {
      throw new Error(
        "Zip archive contains a symbolic link or unsupported special file"
      );
    }

    entries++;
    uncompressedBytes += Number(entry[2]);
    if (entries > MAX_ZIP_ENTRIES) {
      throw new Error("Zip archive exceeds the entry limit");
    }
    if (uncompressedBytes > maxBytes) {
      throw new Error("Zip archive exceeds the extraction limit");
    }
  }

  if (declaredEntries && entries !== Number(declaredEntries[1])) {
    throw new Error("Zip archive contains an unsupported entry type");
  }
}

/**
 * 获取受大小限制的 ZIP 清单，避免大量或超长文件名占满进程内存。
 */
async function getZipListing(zipPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("unzip", [...args, zipPath], {
      maxBuffer: MAX_ZIP_LISTING_BYTES,
    });
    return stdout;
  } catch (error: any) {
    if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new Error("Zip archive exceeds the listing limit");
    }
    throw error;
  }
}

/** 校验目标路径的已有父级均不是符号链接，避免解压写出部署目录。 */
export async function assertNoSymlinkTargets(
  entries: string[],
  baseDir: string
): Promise<void> {
  for (const entry of entries) {
    let current = resolve(baseDir);
    for (const segment of entry.replace(/\\/g, "/").split("/")) {
      if (!segment || segment === ".") continue;
      current = join(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new Error(`Zip entry targets a symbolic link: ${entry}`);
        }
      } catch (error: any) {
        if (error?.code === "ENOENT") break;
        throw error;
      }
    }
  }
}

/** 对磁盘上的 ZIP 完成全部校验后，再解压到部署目录。 */
export async function extractFileAndDeploy(
  zipPath: string,
  envConfig: EnvironmentConfig,
  limitsConfig?: ServerLimitsConfig
): Promise<void> {
  const uploadPath = envConfig.uploadPath;

  // 确保部署目录存在
  if (!existsSync(uploadPath)) {
    await mkdir(uploadPath, { recursive: true });
    console.log(`📁 Created deploy directory: ${uploadPath}`);
  }

  console.log(`📂 Extracting to ${uploadPath}...`);

  // 先校验条目类型、数量和解压后大小，再执行逐路径检查。
  const limits = resolveServerLimits(limitsConfig);
  const zipDetails = await getZipListing(zipPath, ["-Z", "-l"]);
  assertSafeZipEntryTypes(zipDetails, limits.zipExtractBytes);

  // 用 unzip -Z1 列出条目，校验路径不会逃逸或写入已有符号链接。
  const zipList = await getZipListing(zipPath, ["-Z1"]);
  const zipEntries = zipList.split("\n").filter(Boolean);
  assertSafeZipEntries(zipEntries, uploadPath);
  await assertNoSymlinkTargets(zipEntries, uploadPath);

  // 校验通过后才解压到部署目录。
  await execFileAsync("unzip", ["-o", zipPath, "-d", uploadPath]);
  console.log(`✅ Files extracted successfully`);
}

/**
 * 解压 zip 文件并部署
 */
export async function extractAndDeploy(
  zipBuffer: Buffer,
  fileName: string,
  envConfig: EnvironmentConfig,
  env: string,
  limitsConfig?: ServerLimitsConfig
): Promise<void> {
  const uploadPath = envConfig.uploadPath;
  const tempDir = await mkdtemp(join(tmpdir(), "fde-deploy-"));
  const tempZipPath = join(tempDir, "upload.zip");

  try {
    // 保存上传的 Zip 文件
    await Bun.write(tempZipPath, zipBuffer);
    console.log(`📦 Zip file saved to ${tempZipPath}`);

    await extractFileAndDeploy(tempZipPath, envConfig, limitsConfig);
  } catch (error) {
    console.error(`❌ Extraction failed:`, error);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch((error) =>
      console.warn(
        `Failed to clean deployment temp directory ${tempDir}:`,
        error
      )
    );
  }
}

/** 从临时文件复制普通上传，并净化文件名及检查符号链接目标。 */
export async function saveFileFromPath(
  sourcePath: string,
  fileName: string,
  envConfig: EnvironmentConfig
): Promise<void> {
  const uploadPath = envConfig.uploadPath;
  if (!existsSync(uploadPath)) {
    await mkdir(uploadPath, { recursive: true });
    console.log(`📁 Created deploy directory: ${uploadPath}`);
  }

  const safeFileName = basename(fileName);
  if (!safeFileName || safeFileName === "." || safeFileName === "..") {
    throw new Error(`Invalid file name: ${fileName}`);
  }

  await assertNoSymlinkTargets([safeFileName], uploadPath);
  const filePath = join(uploadPath, safeFileName);
  await copyFile(sourcePath, filePath);
  const fileSize = (await stat(sourcePath)).size;
  console.log(`💾 File saved to: ${filePath}`);
  console.log(`📄 File size: ${(fileSize / 1024).toFixed(2)} KB`);
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

    // 保存文件（净化文件名，防止路径穿越）
    const safeFileName = basename(fileName);
    if (!safeFileName || safeFileName === "." || safeFileName === "..") {
      throw new Error(`Invalid file name: ${fileName}`);
    }
    await assertNoSymlinkTargets([safeFileName], uploadPath);
    const filePath = join(uploadPath, safeFileName);
    await Bun.write(filePath, fileBuffer);
    console.log(`💾 File saved to: ${filePath}`);
    console.log(`📄 File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error(`❌ File save failed:`, error);
    throw error;
  }
}
