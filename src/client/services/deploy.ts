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
      throw new Error(
        `Deployment failed with ${response.status}: ${
          result.error || responseText
        }`
      );
    }

    return result;
  } catch (error: any) {
    console.error(`❌ Deployment trigger failed:`, error.message);
    throw error;
  }
}
