import archiver from "archiver";
import { createWriteStream } from "fs";
import { rm } from "fs/promises";
import { basename, join } from "path";
import { tmpdir } from "os";

/**
 * 打包指定目录为 Zip 文件
 */
export async function createZipArchive(
  sourcePath: string,
  outputPath: string,
  excludePatterns: string[] = []
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    let totalBytes = 0;
    let fileCount = 0;

    output.on("close", () => {
      // 换行以清除压缩进度行
      console.log(
        `\n✅ Archive created: ${(archive.pointer() / 1024).toFixed(
          2
        )} KB (${fileCount} files)`
      );
      resolve();
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.on("entry", (entry) => {
      fileCount++;
    });

    archive.on("progress", (progress) => {
      totalBytes = progress.fs.processedBytes;
      const mbProcessed = (totalBytes / 1024 / 1024).toFixed(2);
      process.stdout.write(`\r📦 Compressing... ${mbProcessed} MB processed`);
    });

    archive.pipe(output);

    // 获取源目录名称作为前缀
    const rootFolder = basename(sourcePath);

    // 添加文件到压缩包，排除指定模式
    archive.glob(
      "**/*",
      {
        cwd: sourcePath,
        ignore: excludePatterns,
        dot: true, // 包含隐藏文件
      },
      {
        prefix: rootFolder, // 使用目录名作为前缀
      }
    );

    console.log(`📁 Archiving files from: ${sourcePath}`);
    if (excludePatterns.length > 0) {
      console.log(`🚫 Excluding patterns: ${excludePatterns.join(", ")}`);
    }

    archive.finalize();
  });
}

/**
 * 创建临时 zip 文件并执行回调，完成后自动清理
 * 用于统一目录上传的临时文件处理逻辑
 *
 * @param dirPath 要压缩的目录路径
 * @param env 环境名称（用于生成临时文件名）
 * @param excludePatterns 排除的文件模式
 * @param callback 处理 zip 文件的回调函数
 */
export async function withTempZip<T>(
  dirPath: string,
  env: string,
  excludePatterns: string[],
  callback: (zipPath: string) => Promise<T>
): Promise<T> {
  const tempZipPath = join(tmpdir(), `deploy-${env}-${Date.now()}.zip`);

  try {
    console.log(`\n📁 Preparing directory for upload: ${dirPath}`);
    await createZipArchive(dirPath, tempZipPath, excludePatterns);
    return await callback(tempZipPath);
  } finally {
    // 清理临时压缩文件
    try {
      await rm(tempZipPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
