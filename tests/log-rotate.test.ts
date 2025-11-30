import { describe, it, expect, afterAll } from "bun:test";
import { rotateLogIfNeeded, getLogSize } from "../src/server/utils/log-rotate";
import { join } from "path";
import { writeFile, rm } from "fs/promises";

describe("Log Rotation Tests", () => {
  const TEST_LOG = join(process.cwd(), "test-rotate.log");

  afterAll(async () => {
    // 清理测试日志
    await rm(TEST_LOG, { force: true });
  });

  it("should not rotate small log files", async () => {
    // 创建小文件
    await writeFile(TEST_LOG, "Small log content");

    rotateLogIfNeeded(TEST_LOG, {
      maxSize: 1024 * 1024, // 1MB
      maxBackups: 5,
    });

    const { existsSync } = await import("fs");
    expect(existsSync(TEST_LOG)).toBe(true);
  });

  it("should get log file size", async () => {
    const content = "Test content";
    await writeFile(TEST_LOG, content);

    const size = getLogSize(TEST_LOG);
    expect(size).toContain("B"); // 应该包含单位
  });

  it("should handle non-existent log file", () => {
    const size = getLogSize("./non-existent.log");
    expect(size).toBe("0 B");
  });
});
