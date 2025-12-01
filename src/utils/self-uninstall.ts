import { existsSync, unlinkSync, readdirSync } from "fs";
import { dirname, basename } from "path";

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

  let removedCount = 0;

  // Remove the current binary
  try {
    unlinkSync(currentBinary);
    console.log(`✅ Removed: ${currentFileName}`);
    removedCount++;
  } catch (error: any) {
    console.error(`❌ Failed to remove ${currentFileName}:`, error.message);
    return;
  }

  // Look for other fde-* files in the same directory
  try {
    const files = readdirSync(installDir);
    const fdeFiles = files.filter(
      (f) =>
        f.startsWith("fde-") &&
        f !== currentFileName &&
        existsSync(`${installDir}/${f}`)
    );

    if (fdeFiles.length > 0) {
      console.log("\nFound other FDE files:");
      fdeFiles.forEach((f) => console.log(`  - ${f}`));

      // Prompt user for confirmation using stdin
      process.stdout.write("\nRemove these files? (y/N): ");

      // Read user input from stdin
      for await (const line of console) {
        const response = line.trim();
        if (response.toLowerCase() === "y") {
          for (const file of fdeFiles) {
            try {
              unlinkSync(`${installDir}/${file}`);
              console.log(`✅ Removed: ${file}`);
              removedCount++;
            } catch (error: any) {
              console.error(`❌ Failed to remove ${file}:`, error.message);
            }
          }
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

  console.log(`\n🎉 Uninstalled ${removedCount} file(s)`);
  console.log("\nNote: The install directory is still in your PATH.");
  console.log(
    "You may want to remove it manually from your shell configuration."
  );
}
