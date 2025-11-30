import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { rm, mkdir, writeFile } from "fs/promises";
import { createZipArchive } from "../src/client/services/archive";

describe("Archive Tests", () => {
  const TEST_DIR = join(process.cwd(), "test-archive-temp");
  const TEST_FILES_DIR = join(TEST_DIR, "files");
  const OUTPUT_ZIP = join(TEST_DIR, "output.zip");

  beforeAll(async () => {
    // 创建测试目录和文件
    await mkdir(TEST_FILES_DIR, { recursive: true });
    await writeFile(join(TEST_FILES_DIR, "file1.txt"), "Content 1");
    await writeFile(join(TEST_FILES_DIR, "file2.txt"), "Content 2");
    await mkdir(join(TEST_FILES_DIR, "subdir"), { recursive: true });
    await writeFile(join(TEST_FILES_DIR, "subdir", "file3.txt"), "Content 3");
  });

  afterAll(async () => {
    // 清理测试目录
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should create zip archive", async () => {
    await createZipArchive(TEST_FILES_DIR, OUTPUT_ZIP);

    const { existsSync } = await import("fs");
    expect(existsSync(OUTPUT_ZIP)).toBe(true);
  });

  it("should exclude files matching patterns", async () => {
    const excludeTestDir = join(TEST_DIR, "exclude-test");
    await mkdir(excludeTestDir, { recursive: true });
    await writeFile(join(excludeTestDir, "keep.txt"), "keep me");
    await writeFile(join(excludeTestDir, "exclude.log"), "exclude me");
    await mkdir(join(excludeTestDir, "node_modules"), { recursive: true });
    await writeFile(join(excludeTestDir, "node_modules", "pkg.json"), "{}");

    const outputZip = join(TEST_DIR, "exclude-output.zip");
    await createZipArchive(excludeTestDir, outputZip, [
      "*.log",
      "node_modules",
    ]);

    const { existsSync } = await import("fs");
    expect(existsSync(outputZip)).toBe(true);

    // TODO: 验证 zip 内容不包含被排除的文件
  });

  it("should handle empty directory", async () => {
    const emptyDir = join(TEST_DIR, "empty");
    await mkdir(emptyDir, { recursive: true });

    const outputZip = join(TEST_DIR, "empty-output.zip");
    await createZipArchive(emptyDir, outputZip);

    const { existsSync } = await import("fs");
    expect(existsSync(outputZip)).toBe(true);
  });
});
