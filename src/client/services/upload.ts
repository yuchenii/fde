import { stat, rm } from "fs/promises";
import { basename } from "path";
import { createZipArchive } from "./archive";
import type { ClientConfig } from "../types";
import FormData from "form-data";
import { calculateChecksumFromFile } from "../../utils/checksum";

/**
 * 直接上传单个文件（不压缩）
 * upload 接口现在完成所有处理（校验、保存）
 */
export async function uploadFile(
  filePath: string,
  serverUrl: string,
  authToken: string,
  env: string,
  skipChecksum: boolean = false,
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
    let checksum = "";
    if (!skipChecksum) {
      console.log(`🔐 Calculating checksum...`);
      checksum = await calculateChecksumFromFile(filePath);
      console.log(`✅ Checksum (SHA256): ${checksum.substring(0, 16)}...`);
    } else {
      console.log(`⏭️  Skipping checksum verification`);
    }

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
      authorization: authToken,
    };

    // 发送请求到 /upload 端点
    const response = await fetch(`${serverUrl}/upload`, {
      method: "POST",
      headers,
      body: formData,
    });

    const responseText = await response.text();
    let result;

    try {
      result = JSON.parse(responseText);
    } catch {
      result = { raw: responseText };
    }

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
  authToken: string,
  env: string,
  excludePatterns: string[] = [],
  skipChecksum: boolean = false
): Promise<any> {
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const tempZipPath = join(tmpdir(), `deploy-${env}-${Date.now()}.zip`);

  try {
    console.log(`\n📁 Preparing directory for upload: ${dirPath}`);

    // 压缩目录
    await createZipArchive(dirPath, tempZipPath, excludePatterns);

    // 使用 uploadFile 上传压缩包（需要解压）
    const result = await uploadFile(
      tempZipPath,
      serverUrl,
      authToken,
      env,
      skipChecksum,
      true // 目录压缩后需要解压
    );

    return result;
  } catch (error: any) {
    console.error(`❌ Upload failed:`, error.message);
    throw error;
  } finally {
    // 清理临时压缩文件
    try {
      await rm(tempZipPath, { force: true });
    } catch {}
  }
}
