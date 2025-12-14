import { stat } from "fs/promises";
import { basename } from "path";
import { withTempZip } from "./archive";
import { parseJsonResponse } from "../utils/response";
import FormData from "form-data";
import { calculateChecksumFromFile } from "@/utils/checksum";

/**
 * 直接上传单个文件（不压缩）
 * upload 接口现在完成所有处理（校验、保存）
 */
export async function uploadFile(
  filePath: string,
  serverUrl: string,
  token: string,
  env: string,
  shouldExtract: boolean = false
): Promise<any> {
  console.log(`\n📄 Uploading single file: ${basename(filePath)}`);
  console.log(`🚀 Uploading to ${serverUrl}...`);

  try {
    // 获取文件大小
    const stats = await stat(filePath);
    const fileSize = stats.size;
    console.log(`📤 File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    // 计算文件校验和
    console.log(`🔐 Calculating checksum...`);
    const checksum = await calculateChecksumFromFile(filePath);
    console.log(`✅ Checksum (SHA256): ${checksum.substring(0, 16)}...`);

    // 使用 Bun 原生方式读取文件
    const fileData = Bun.file(filePath);
    const fileBlob = await fileData.arrayBuffer();

    // 创建 FormData，包含文件和元数据
    const formData = new FormData();
    const file = new File([fileBlob], basename(filePath), {
      type: "application/octet-stream",
    });
    formData.append("file", file);
    formData.append("env", env);
    formData.append("shouldExtract", shouldExtract.toString());

    if (checksum) {
      formData.append("checksum", checksum);
    }

    // 只保留认证信息在header
    const headers: Record<string, string> = {
      Authorization: token,
    };

    // 发送请求到 /upload 端点
    const response = await fetch(`${serverUrl}/upload`, {
      method: "POST",
      headers,
      body: formData,
    });

    const responseText = await response.text();
    const result = parseJsonResponse(responseText);

    if (!response.ok) {
      throw new Error(
        `Server responded with ${response.status}: ${
          result.error || responseText
        }`
      );
    }

    console.log(`✅ Upload completed successfully!`);

    // 返回 uploadId
    return result.uploadId;
  } catch (error: any) {
    console.error(`❌ Upload failed:`, error.message);
    throw error;
  }
}

/**
 * 压缩并上传目录
 * upload 接口现在完成所有处理（校验、解压、保存）
 */
export async function uploadDirectory(
  dirPath: string,
  serverUrl: string,
  token: string,
  env: string,
  excludePatterns: string[] = []
): Promise<any> {
  return withTempZip(dirPath, env, excludePatterns, async (tempZipPath) => {
    return uploadFile(
      tempZipPath,
      serverUrl,
      token,
      env,
      true // 目录压缩后需要解压
    );
  });
}
