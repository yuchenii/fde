import { parseJsonResponse } from "../utils/response";

/**
 * 调用部署接口（只需要环境参数）
 */
export async function triggerDeploy(
  serverUrl: string,
  env: string,
  authToken: string
): Promise<any> {
  console.log(`\n🚀 Triggering deployment...`);

  try {
    const response = await fetch(`${serverUrl}/deploy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authToken,
      },
      body: JSON.stringify({ env }),
    });

    const responseText = await response.text();
    const result = parseJsonResponse(responseText);

    if (!response.ok) {
      // 显示服务端脚本的详细输出
      if (result.stdout || result.stderr) {
        console.error(`\n📋 Deploy script output:`);
        if (result.stdout) {
          console.error(`\n--- stdout ---\n${result.stdout}`);
        }
        if (result.stderr) {
          console.error(`\n--- stderr ---\n${result.stderr}`);
        }
        if (result.exitCode !== undefined) {
          console.error(`\n--- exit code: ${result.exitCode} ---`);
        }
      }
      throw new Error(
        `Deployment failed with ${response.status}: ${
          result.error || result.details || responseText
        }`
      );
    }

    // 成功时也显示脚本输出
    if (result.stdout || result.stderr) {
      console.log(`\n📋 Deploy script output:`);
      if (result.stdout) {
        console.log(`${result.stdout.trim()}`);
      }
      if (result.stderr) {
        console.log(`${result.stderr.trim()}`);
      }
    }

    return result;
  } catch (error: any) {
    console.error(`❌ Deployment trigger failed:`, error.message);
    throw error;
  }
}
