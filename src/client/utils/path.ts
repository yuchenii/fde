import { stat } from "fs/promises";

/**
 * 检测路径类型：文件或目录
 */
export async function detectPathType(
  path: string
): Promise<"file" | "directory"> {
  const stats = await stat(path);
  return stats.isDirectory() ? "directory" : "file";
}
