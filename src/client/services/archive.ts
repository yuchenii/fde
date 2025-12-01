import archiver from "archiver";
import { createWriteStream } from "fs";
import { basename } from "path";

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
