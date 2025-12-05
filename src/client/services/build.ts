import { exec } from "child_process";
import { promisify } from "util";
import { parseScriptCommand } from "@/utils/command";

const execAsync = promisify(exec);

/**
 * 执行构建命令
 * @param command 构建命令
 * @param configDir 配置文件所在目录（用于解析相对路径脚本）
 */
export async function runBuildCommand(
  command: string,
  configDir: string
): Promise<void> {
  if (!command || command.trim() === "") {
    console.log("⏭️  No build command specified");
    return;
  }

  const { command: finalCommand, scriptDir } = parseScriptCommand(
    command,
    configDir
  );

  // 决定执行目录：脚本命令在脚本目录执行，普通命令在当前工作目录执行
  const cwd = scriptDir || process.cwd();

  console.log(`🔨 Running build command: ${finalCommand}`);
  if (scriptDir) {
    console.log(`📂 Working directory: ${cwd}`);
  }

  try {
    const { stdout, stderr } = await execAsync(finalCommand, { cwd });
    if (stdout) console.log(stdout);
    if (stderr) console.warn(stderr);
    console.log("✅ Build command completed");
  } catch (error: any) {
    console.error(`❌ Build command failed:`, error.message);
    throw error;
  }
}
