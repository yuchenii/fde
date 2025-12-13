/**
 * 调用部署接口（流式输出，支持断连重连）
 */
export async function triggerDeploy(
  serverUrl: string,
  env: string,
  authToken: string
): Promise<any> {
  console.log(`\n🚀 Triggering deployment...`);

  const maxRetries = 3;
  let lastEventId: string | null = null;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: authToken,
      };

      // 如果有 lastEventId，添加到请求头用于续接
      if (lastEventId) {
        headers["Last-Event-ID"] = lastEventId;
        console.log(`\n🔄 Reconnecting from event ${lastEventId}...`);
      }

      const response = await fetch(`${serverUrl}/deploy`, {
        method: "POST",
        headers,
        body: JSON.stringify({ env, stream: true }),
      });

      // 检查是否为非 200 响应（验证失败等）
      if (!response.ok) {
        const text = await response.text();
        let errorMsg = text;
        try {
          const json = JSON.parse(text);
          errorMsg = json.error || json.details || text;
        } catch {}

        // 409 Conflict: 并发部署冲突
        if (response.status === 409) {
          throw new Error(`⚠️ 部署冲突: ${errorMsg}\n请等待当前部署完成后再试`);
        }

        throw new Error(
          `Deployment failed with ${response.status}: ${errorMsg}`
        );
      }

      const result = await handleStreamResponse(response, (id) => {
        lastEventId = id;
      });

      return result;
    } catch (error: any) {
      // 如果是部署失败的错误（有 exitCode），直接抛出
      if (error.message.includes("exit code")) {
        throw error;
      }

      // 网络错误，尝试重连
      if (lastEventId && retryCount < maxRetries) {
        retryCount++;
        // 指数退避 + 随机抖动
        const baseDelay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        const jitter = Math.random() * 500;
        const retryDelay = baseDelay + jitter;
        console.log(
          `\n⚠️ Connection lost, retrying in ${(retryDelay / 1000).toFixed(
            1
          )}s... (${retryCount}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }

      // 重试用尽，尝试查询状态
      if (lastEventId) {
        console.log(`\n📋 Checking deployment status...`);
        try {
          const status = await getDeployStatus(serverUrl, env, authToken);
          if (status.lastResult) {
            if (status.lastResult.success) {
              console.log(`\n✅ Deployment completed successfully`);
              return { success: true, ...status.lastResult };
            } else {
              throw new Error(
                `Deployment failed with exit code ${status.lastResult.exitCode}`
              );
            }
          }
        } catch (statusError: any) {
          console.error(`❌ Failed to get status:`, statusError.message);
        }
      }

      console.error(`❌ Deployment trigger failed:`, error.message);
      throw error;
    }
  }

  throw new Error("Max retries exceeded");
}

/**
 * 查询部署状态
 */
async function getDeployStatus(
  serverUrl: string,
  env: string,
  authToken: string
): Promise<any> {
  const response = await fetch(`${serverUrl}/deploy/status?env=${env}`, {
    method: "GET",
    headers: {
      Authorization: authToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Status check failed: ${response.status}`);
  }

  return await response.json();
}

/**
 * 处理 SSE 流式响应
 */
async function handleStreamResponse(
  response: Response,
  onEventId?: (id: string) => void
): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Failed to get response reader");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let result: any = {};

  console.log(`\n📋 Deploy script output:`);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 解析 SSE 事件
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // 保留未完成的行

    let currentEvent = "";
    let currentId = "";
    for (const line of lines) {
      if (line.startsWith("id: ")) {
        currentId = line.slice(4);
        if (onEventId) {
          onEventId(currentId);
        }
      } else if (line.startsWith("event: ")) {
        currentEvent = line.slice(7);
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));

        if (currentEvent === "output") {
          // 实时输出
          process.stdout.write(data.data);
        } else if (currentEvent === "done") {
          result = data;
        } else if (currentEvent === "error") {
          result = data;
          if (data.exitCode !== undefined && data.exitCode !== 0) {
            throw new Error(
              `Deployment failed with exit code ${data.exitCode}`
            );
          }
          // 如果没有 exitCode 但有错误，可能是续接时发现没有部署
          if (data.error === "No deployment in progress") {
            // 这不是真正的错误，只是没有正在进行的部署
            console.log(`\n⚠️ ${data.error}`);
            return result;
          }
          throw new Error(data.error || data.details || "Deploy failed");
        }
      }
    }
  }

  console.log(""); // 换行
  return result;
}
