import { VERSION } from "@/version";
import {
  writeFileSync,
  chmodSync,
  unlinkSync,
  renameSync,
  existsSync,
} from "fs";
import { dirname, basename, join } from "path";
import cliProgress from "cli-progress";
import { calculateChecksum } from "./checksum";

const REPO = "yuchenii/fde";

/** 从 SHA256SUMS.txt 中精确查找指定发布文件的校验和。 */
export function getExpectedChecksum(
  manifest: string,
  fileName: string
): string {
  for (const line of manifest.split("\n")) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match?.[2] === fileName) {
      return match[1].toLowerCase();
    }
  }
  throw new Error(`Checksum not found for ${fileName}`);
}

/** 在写入和替换本地可执行文件前验证下载内容。 */
function verifyReleaseBinary(
  buffer: ArrayBuffer,
  fileName: string,
  checksumManifest: string
): void {
  const expected = getExpectedChecksum(checksumManifest, fileName);
  const actual = calculateChecksum(Buffer.from(buffer));
  if (actual !== expected) {
    throw new Error(`Checksum verification failed for ${fileName}`);
  }
}

/**
 * Detect platform and architecture
 */
function getPlatformInfo(): { platform: string; arch: string } {
  let platform: string = process.platform;
  let arch: string = process.arch;

  // Convert platform names
  if (platform === "darwin") platform = "macos";
  else if (platform === "win32") platform = "windows";
  else if (platform === "linux") platform = "linux";
  else throw new Error(`Unsupported platform: ${platform}`);

  // Convert architecture names
  if (arch === "x64") arch = "x64";
  else if (arch === "arm64") arch = "arm64";
  else throw new Error(`Unsupported architecture: ${arch}`);

  return { platform, arch };
}

/**
 * Download file with progress bar
 */
async function downloadWithProgress(
  url: string,
  fileName: string
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  const totalBytes = parseInt(response.headers.get("content-length") || "0");
  const totalMB = (totalBytes / 1024 / 1024).toFixed(2);

  // Create progress bar
  const progressBar = new cliProgress.SingleBar({
    format:
      "📥 [{bar}] {percentage}% | {downloadedMB}/{totalMB} MB | {speed} | ETA: {eta}s",
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
    hideCursor: true,
  });

  progressBar.start(totalBytes, 0, {
    downloadedMB: "0.00",
    totalMB: totalMB,
    speed: "0 KB/s",
    eta: "0",
  });

  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  const startTime = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    downloadedBytes += value.length;

    // Calculate speed
    const elapsed = Math.max((Date.now() - startTime) / 1000, 0.001);
    const bytesPerSecond = downloadedBytes / elapsed;

    // Dynamic speed unit
    let speedText: string;
    if (bytesPerSecond < 1024 * 1024) {
      speedText = `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
    } else {
      speedText = `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
    }

    // Calculate ETA
    const remainingBytes = totalBytes - downloadedBytes;
    const eta = (remainingBytes / Math.max(bytesPerSecond, 1)).toFixed(0);

    progressBar.update(downloadedBytes, {
      downloadedMB: (downloadedBytes / 1024 / 1024).toFixed(2),
      totalMB: totalMB,
      speed: speedText,
      eta: eta,
    });
  }

  progressBar.stop();

  // Combine chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.buffer;
}

/**
 * Clean up old files from previous updates (Windows .old files)
 */
function cleanupOldFiles(installDir: string): void {
  try {
    const oldServerPath = join(installDir, "fde-server.exe.old");
    const oldClientPath = join(installDir, "fde-client.exe.old");

    if (existsSync(oldServerPath)) {
      unlinkSync(oldServerPath);
      console.log("🧹 Cleaned up old fde-server.exe.old");
    }
    if (existsSync(oldClientPath)) {
      unlinkSync(oldClientPath);
      console.log("🧹 Cleaned up old fde-client.exe.old");
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Replace executable file - handles Windows locked file scenario
 * On Windows: rename current -> .old, rename .tmp -> current
 * On Unix: delete current, rename .tmp -> current
 */
function replaceExecutable(
  tempPath: string,
  targetPath: string,
  isWindows: boolean
): void {
  const oldPath = `${targetPath}.old`;

  if (isWindows) {
    // Windows strategy: rename running exe to .old, then rename .tmp to target
    // Windows allows renaming a running executable but not deleting it
    try {
      // Remove any existing .old file first
      if (existsSync(oldPath)) {
        unlinkSync(oldPath);
      }
    } catch {
      // Ignore - file might not exist or can't be deleted
    }

    try {
      // Rename current running exe to .old
      if (existsSync(targetPath)) {
        renameSync(targetPath, oldPath);
      }
    } catch (err: any) {
      throw new Error(`Failed to rename current executable: ${err.message}`);
    }

    try {
      // Rename .tmp to target
      renameSync(tempPath, targetPath);
    } catch (err: any) {
      // Try to restore the old file if rename failed
      try {
        if (existsSync(oldPath)) {
          renameSync(oldPath, targetPath);
        }
      } catch {}
      throw new Error(`Failed to install new executable: ${err.message}`);
    }
  } else {
    // Unix strategy: delete current, rename .tmp to target
    try {
      if (existsSync(targetPath)) {
        unlinkSync(targetPath);
      }
    } catch {}

    renameSync(tempPath, targetPath);
    chmodSync(targetPath, 0o755);
  }
}

/**
 * Check for updates and optionally perform self-update
 */
export async function checkAndUpdate(): Promise<void> {
  console.log(`Current version: v${VERSION}`);
  console.log("Checking for updates...\n");

  try {
    // Get the real path of the current executable (compiled binary)
    const currentBinary = process.execPath;
    const installDir = dirname(currentBinary);

    // Clean up old files from previous updates
    cleanupOldFiles(installDir);

    // Fetch latest release from GitHub
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch release info: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      tag_name: string;
      html_url: string;
    };
    const latestVersion = data.tag_name;

    console.log(`Latest version: ${latestVersion}`);

    if (latestVersion === `v${VERSION}`) {
      console.log("\n✅ You are already on the latest version!");
      return;
    }

    console.log("\n🆕 A new version is available!");
    console.log("Downloading and installing...\n");

    // Get platform info
    const { platform, arch } = getPlatformInfo();
    const isWindows = platform === "windows";

    const binaryName = basename(currentBinary);

    console.log(`Install directory: ${installDir}\n`);

    // Determine download URL
    const serverFile = `fde-server-${platform}-${arch}${
      isWindows ? ".exe" : ""
    }`;
    const clientFile = `fde-client-${platform}-${arch}${
      isWindows ? ".exe" : ""
    }`;
    const baseUrl = `https://github.com/${REPO}/releases/download/${latestVersion}`;
    // 清单只下载一次，当前和另一个二进制都必须先校验再落盘。
    const checksumResponse = await fetch(`${baseUrl}/SHA256SUMS.txt`);
    if (!checksumResponse.ok) {
      throw new Error("Failed to download release checksums");
    }
    const checksumManifest = await checksumResponse.text();

    // Determine which file to download based on current binary
    const isServer = binaryName.includes("server");
    const currentFile = isServer ? serverFile : clientFile;
    const otherFile = isServer ? clientFile : serverFile;
    const currentName = isServer ? "fde-server" : "fde-client";
    const otherName = isServer ? "fde-client" : "fde-server";

    // Final binary paths (short names)
    const currentFinalPath = join(
      installDir,
      `${currentName}${isWindows ? ".exe" : ""}`
    );
    const otherFinalPath = join(
      installDir,
      `${otherName}${isWindows ? ".exe" : ""}`
    );

    // Download and update current binary
    console.log(`Updating ${currentName}...`);
    const buffer = await downloadWithProgress(
      `${baseUrl}/${currentFile}`,
      currentFile
    );
    verifyReleaseBinary(buffer, currentFile, checksumManifest);

    // Write to temporary file first
    const tempFile = `${currentFinalPath}.tmp`;
    writeFileSync(tempFile, new Uint8Array(buffer));
    if (!isWindows) {
      chmodSync(tempFile, 0o755);
    }

    // Replace the current binary using platform-specific strategy
    replaceExecutable(tempFile, currentFinalPath, isWindows);

    console.log(`✅ ${currentName} updated successfully!\n`);

    if (isWindows) {
      console.log("💡 Note: Old executable will be cleaned up on next run.\n");
    }

    // Ask user if they want to update the other binary (server/client)
    process.stdout.write(`Also update ${otherName}? (Y/n): `);

    // Read user input from stdin
    let shouldUpdateOther = true; // Default to yes
    for await (const line of console) {
      const response = line.trim().toLowerCase();
      if (response === "n" || response === "no") {
        shouldUpdateOther = false;
      }
      break; // Only read one line
    }

    if (shouldUpdateOther) {
      console.log(`\nUpdating ${otherName}...`);
      try {
        const otherBuffer = await downloadWithProgress(
          `${baseUrl}/${otherFile}`,
          otherFile
        );
        verifyReleaseBinary(otherBuffer, otherFile, checksumManifest);

        // Write to temporary file first
        const otherTempFile = `${otherFinalPath}.tmp`;
        writeFileSync(otherTempFile, new Uint8Array(otherBuffer));
        if (!isWindows) {
          chmodSync(otherTempFile, 0o755);
        }

        // Replace using platform-specific strategy
        replaceExecutable(otherTempFile, otherFinalPath, isWindows);
        console.log(`✅ ${otherName} updated successfully!`);
      } catch (error: any) {
        console.warn(`\n⚠️  Failed to update ${otherName}:`, error.message);
      }
    } else {
      console.log(`Skipped updating ${otherName}`);
    }

    console.log(`\n🎉 Update completed! Now running ${latestVersion}`);
  } catch (error: any) {
    console.error("\n❌ Failed to update:", error.message);
    process.exit(1);
  }
}
