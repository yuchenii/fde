import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * 执行构建命令
 */
export async function runBuildCommand(command: string): Promise<void> {
  if (!command || command.trim() === "") {
    console.log("⏭️  No build command specified");
    return;
  }

  console.log(`🔨 Running build command: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command);
    if (stdout) console.log(stdout);
    if (stderr) console.warn(stderr);
    console.log("✅ Build command completed");
  } catch (error: any) {
    console.error(`❌ Build command failed:`, error.message);
    throw error;
  }
}
