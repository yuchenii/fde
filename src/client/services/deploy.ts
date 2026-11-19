class DeployError extends Error {}

/**
 * 调用部署接口（流式输出，支持断连重连）
 */
export async function triggerDeploy(
  serverUrl: string,
  env: string,
  token: string
): Promise<any> {
  console.log(`\n🚀 Triggering deployment...`);

  const maxRetries = 3;
  let deploymentId: string | null = null;
  let lastEventId: string | null = null;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: token,
      };

      if (deploymentId) {
        headers["X-Deployment-ID"] = deploymentId;
        headers["Last-Event-ID"] = lastEventId ?? "0";
        console.log(`\n🔄 Reconnecting from event ${headers["Last-Event-ID"]}...`);
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
          throw new DeployError(`⚠️ 部署冲突: ${errorMsg}\n请等待当前部署完成后再试`);
        }
        const message = `Deployment failed with ${response.status}: ${errorMsg}`;
        if (response.status === 410) throw new DeployError(message);
        throw new Error(message);
      }

      const responseId = response.headers.get("x-deployment-id");
      if (deploymentId && responseId !== deploymentId) {
        await response.body?.cancel();
        throw new DeployError("Cannot confirm the identity of the resumed deployment");
      }
      deploymentId = responseId;
      return await handleStreamResponse(response, (id) => {
        lastEventId = id;
      });
    } catch (error: any) {
      if (error instanceof DeployError || !deploymentId) {
        throw error;
      }

      // 网络错误，尝试重连
      if (retryCount < maxRetries) {
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
      console.log(`\n📋 Checking deployment status...`);
      const status = await getDeployStatus(serverUrl, env, token, deploymentId);
      if (status.deploymentId === deploymentId && status.lastResult) {
        if (!status.lastResult.success) {
          throw new DeployError(`Deployment failed with exit code ${status.lastResult.exitCode}`);
        }
        return status.lastResult;
      }
      throw new Error(`Cannot confirm deployment result: ${error.message}`);
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
  token: string,
  deploymentId: string
): Promise<any> {
  const response = await fetch(`${serverUrl}/deploy/status?${new URLSearchParams({ env })}`, {
    headers: { Authorization: token, "X-Deployment-ID": deploymentId },
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
  let currentEvent = "";
  let currentId = "";

  console.log(`\n📋 Deploy script output:`);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("Deployment stream ended before a final event");
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line === "") {
          currentEvent = "";
          currentId = "";
        } else if (line.startsWith("id: ")) {
          currentId = line.slice(4);
        } else if (line.startsWith("event: ")) {
          currentEvent = line.slice(7);
        } else if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === "output") {
            process.stdout.write(data.data);
            if (currentId) onEventId?.(currentId);
          } else if (currentEvent === "done" && data.success === true) {
            return data;
          } else if (currentEvent === "error") {
            throw new DeployError(data.exitCode !== undefined
              ? `Deployment failed with exit code ${data.exitCode}`
              : data.error || "Deploy failed");
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
