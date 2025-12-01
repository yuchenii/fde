import { VERSION } from "../version";
import { writeFileSync, chmodSync, unlinkSync } from "fs";
import { dirname, basename } from "path";
import cliProgress from "cli-progress";

const REPO = "yuchenii/fde";

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
 * Check for updates and optionally perform self-update
 */
export async function checkAndUpdate(): Promise<void> {
  console.log(`Current version: v${VERSION}`);
  console.log("Checking for updates...\n");

  try {
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

    // Get the real path of the current executable (compiled binary)
    const currentBinary = process.execPath;
    const installDir = dirname(currentBinary);
    const binaryName = basename(currentBinary);

    console.log(`Install directory: ${installDir}\n`);

    // Determine download URL
    const isWindows = platform === "windows";
    const serverFile = `fde-server-${platform}-${arch}${
      isWindows ? ".exe" : ""
    }`;
    const clientFile = `fde-client-${platform}-${arch}${
      isWindows ? ".exe" : ""
    }`;
    const baseUrl = `https://github.com/${REPO}/releases/download/${latestVersion}`;

    // Determine which file to download based on current binary
    const isServer = binaryName.includes("server");
    const currentFile = isServer ? serverFile : clientFile;
    const otherFile = isServer ? clientFile : serverFile;
    const currentName = isServer ? "fde-server" : "fde-client";
    const otherName = isServer ? "fde-client" : "fde-server";

    // Final binary paths (short names)
    const currentFinalPath = `${installDir}/${currentName}${
      isWindows ? ".exe" : ""
    }`;
    const otherFinalPath = `${installDir}/${otherName}${
      isWindows ? ".exe" : ""
    }`;

    // Download and update current binary
    console.log(`Updating ${currentName}...`);
    const buffer = await downloadWithProgress(
      `${baseUrl}/${currentFile}`,
      currentFile
    );

    // Write to temporary file first
    const tempFile = `${currentFinalPath}.tmp`;
    writeFileSync(tempFile, new Uint8Array(buffer));
    chmodSync(tempFile, 0o755);

    // Replace the current binary
    try {
      unlinkSync(currentFinalPath);
    } catch {}
    writeFileSync(currentFinalPath, new Uint8Array(buffer));
    chmodSync(currentFinalPath, 0o755);

    // Clean up temp file if it exists
    try {
      unlinkSync(tempFile);
    } catch {}

    console.log(`✅ ${currentName} updated successfully!\n`);

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
        writeFileSync(otherFinalPath, new Uint8Array(otherBuffer));
        chmodSync(otherFinalPath, 0o755);
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
