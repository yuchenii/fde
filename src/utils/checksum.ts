import crypto from "crypto";
import { readFile } from "fs/promises";

/**
 * 计算 Buffer 的 SHA256 校验和
 */
export function calculateChecksum(buffer: Buffer): string {
  const hash = crypto.createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

/**
 * 计算文件的 SHA256 校验和
 */
export async function calculateChecksumFromFile(
  filePath: string
): Promise<string> {
  const fileBuffer = await readFile(filePath);
  return calculateChecksum(fileBuffer);
}

/**
 * 验证 Buffer 的 SHA256 校验和
 */
export function verifyChecksum(
  buffer: Buffer,
  expectedChecksum: string
): boolean {
  const actualChecksum = calculateChecksum(buffer);
  return actualChecksum === expectedChecksum;
}
