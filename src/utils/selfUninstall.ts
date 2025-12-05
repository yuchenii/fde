import { existsSync, unlinkSync, readdirSync, writeFileSync } from "fs";
import { dirname, basename, join } from "path";
import { spawn } from "child_process";

const isWindows = process.platform === "win32";

/**
 * Create a Windows batch script for delayed uninstall in TEMP directory
 * The script waits for the process to exit, then deletes the files
 */
function createWindowsUninstallScript(
  installDir: string,
  filesToRemove: string[]
): string {
  // Create script in TEMP directory so it doesn't block rmdir
  const tempDir = process.env.TEMP || "C:\\Windows\\Temp";
  const scriptPath = join(tempDir, `fde-uninstall-${Date.now()}.bat`);

  // Delete commands for all FDE files
  const deleteCommands = filesToRemove
    .map((f) => `del /f /q "${join(installDir, f)}" 2>nul`)
    .join("\n");

  const scriptContent = `@echo off
echo Waiting for FDE to exit...
timeout /t 2 /nobreak >nul
echo.
echo Removing FDE files...
${deleteCommands}
echo.
echo FDE files removed successfully.
echo.
echo Removing install directory...
rmdir "${installDir}" 2>nul
if exist "${installDir}" (
  echo Note: Install directory not empty, keeping it.
) else (
  echo Install directory removed.
)
echo.
echo Note: FDE may still be in your PATH.
echo You may want to remove it manually from System Environment Variables.
echo.
echo Uninstall complete. Press any key to close...
pause >nul
(del /f /q "%~f0" >nul 2>&1 & exit)
`;

  writeFileSync(scriptPath, scriptContent);
  return scriptPath;
}

/**
 * Uninstall FDE binaries
 */
export async function uninstall(): Promise<void> {
  console.log("🗑️  Uninstalling FDE...\n");

  // Get the real path of the current executable (compiled binary)
  const currentBinary = process.execPath;
  const installDir = dirname(currentBinary);
  const currentFileName = basename(currentBinary);

  console.log(`Current executable: ${currentBinary}`);
  console.log(`Install directory: ${installDir}`);
  console.log("");

  // Collect all files to remove
  const filesToRemove: string[] = [currentFileName];

  // Look for other fde-* files in the same directory
  try {
    const files = readdirSync(installDir);
    const fdeFiles = files.filter(
      (f) =>
        f.startsWith("fde-") &&
        f !== currentFileName &&
        !f.endsWith(".bat") && // Exclude batch scripts
        existsSync(join(installDir, f))
    );

    if (fdeFiles.length > 0) {
      console.log("Found other FDE files:");
      fdeFiles.forEach((f) => console.log(`  - ${f}`));

      // Prompt user for confirmation using stdin
      process.stdout.write("\nRemove these files too? (y/N): ");

      // Read user input from stdin
      for await (const line of console) {
        const response = line.trim();
        if (response.toLowerCase() === "y") {
          filesToRemove.push(...fdeFiles);
        }
        break; // Only read one line
      }
    }
  } catch (error: any) {
    console.warn(
      "⚠️  Could not scan directory for other files:",
      error.message
    );
  }

  console.log("");

  if (isWindows) {
    // Windows: Create a batch script to delete files after this process exits
    console.log("📝 Creating uninstall script...");

    // Also clean up any .old and .tmp files from previous updates
    try {
      const files = readdirSync(installDir);
      const cleanupFiles = files.filter(
        (f) =>
          (f.endsWith(".old") || f.endsWith(".tmp")) && f.startsWith("fde-")
      );
      filesToRemove.push(...cleanupFiles);
    } catch {}

    const scriptPath = createWindowsUninstallScript(installDir, filesToRemove);

    console.log("\n🚀 Starting uninstall script and exiting...\n");
    console.log("Files to be removed:");
    filesToRemove.forEach((f) => console.log(`  - ${f}`));
    console.log("");

    // Use 'start' to run the batch script in a new visible window
    // This ensures pause works and user can see the output
    const child = spawn(
      "cmd.exe",
      ["/c", "start", "FDE Uninstall", scriptPath],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }
    );
    child.unref();

    // Exit immediately so the batch script can delete files
    process.exit(0);
  } else {
    // Unix/macOS: Can delete files directly
    let removedCount = 0;

    for (const file of filesToRemove) {
      const filePath = join(installDir, file);
      try {
        unlinkSync(filePath);
        console.log(`✅ Removed: ${file}`);
        removedCount++;
      } catch (error: any) {
        console.error(`❌ Failed to remove ${file}:`, error.message);
      }
    }

    console.log(`\n🎉 Uninstalled ${removedCount} file(s)`);
    console.log("\nNote: FDE may still be in your PATH.");
    console.log(
      "You may want to remove it manually from your shell configuration."
    );
  }
}
