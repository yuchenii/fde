import { spawn } from "child_process";
import { resolveCommandCwd, type PathContext } from "@/utils/path";

/**
 * 执行构建命令（实时输出）
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

  // 使用统一的路径解析（客户端不在 Docker 环境）
  const pathContext: PathContext = { configDir };
  const { command: finalCommand, cwd } = resolveCommandCwd(
    command,
    pathContext
  );

  console.log(`🔨 Running build command: ${finalCommand}`);
  console.log(`📂 Working directory: ${cwd}`);

  return new Promise((resolve, reject) => {
    // 使用 stdio: "inherit" 直接继承终端，保留 TTY 特性（颜色、进度条等）
    const child = spawn(finalCommand, {
      cwd,
      shell: true,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log("✅ Build command completed");
        resolve();
      } else {
        const error = new Error(`Build command exited with code ${code}`);
        console.error(`❌ Build command failed:`, error.message);
        reject(error);
      }
    });

    child.on("error", (error) => {
      console.error(`❌ Build command failed:`, error.message);
      reject(error);
    });
  });
}
