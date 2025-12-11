/**
 * 检查服务器连接状态
 */
export async function checkServerConnection(
  serverUrl: string
): Promise<boolean> {
  try {
    console.log(`🔍 Checking server connection: ${serverUrl}`);

    const response = await fetch(`${serverUrl}/ping`, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5秒超时
    });

    if (response.ok) {
      const text = await response.text();
      if (text === "pong") {
        console.log(`✅ Server is reachable`);
        return true;
      }
    }

    console.error(`❌ Server responded but health check failed`);
    return false;
  } catch (error: any) {
    if (error.name === "TimeoutError") {
      console.error(`❌ Server connection timeout (5s)`);
    } else if (error.code === "ECONNREFUSED") {
      console.error(`❌ Connection refused - is the server running?`);
    } else {
      console.error(`❌ Failed to connect to server: ${error.message}`);
    }
    return false;
  }
}

/**
 * 检查服务器详细健康状态
 */
export async function checkServerHealth(serverUrl: string): Promise<any> {
  try {
    console.log(`🔍 Checking server health: ${serverUrl}`);

    const response = await fetch(`${serverUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5秒超时
    });

    if (response.ok) {
      const data = await response.json();
      return data;
    }

    console.error(`❌ Server responded with status: ${response.status}`);
    return null;
  } catch (error: any) {
    if (error.name === "TimeoutError") {
      console.error(`❌ Server connection timeout (5s)`);
    } else if (error.code === "ECONNREFUSED") {
      console.error(`❌ Connection refused - is the server running?`);
    } else {
      console.error(`❌ Failed to connect to server: ${error.message}`);
    }
    return null;
  }
}

/**
 * 验证认证 Token（在 build 之前调用）
 * 确保 token 正确，避免 build 完成后上传时才发现 token 错误
 */
export async function verifyAuthToken(
  serverUrl: string,
  authToken: string,
  env: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    console.log(`🔐 Verifying authentication token...`);

    const response = await fetch(`${serverUrl}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authToken,
      },
      body: JSON.stringify({ env }),
      signal: AbortSignal.timeout(10000), // 10秒超时
    });

    if (response.ok) {
      console.log(`✅ Authentication verified`);
      return { valid: true };
    }

    const data = (await response
      .json()
      .catch(() => ({ error: undefined }))) as { error?: string };
    const errorMessage =
      data.error || `Server responded with ${response.status}`;
    console.error(`❌ Token verification failed: ${errorMessage}`);
    return { valid: false, error: errorMessage };
  } catch (error: any) {
    if (error.name === "TimeoutError") {
      return { valid: false, error: "Token verification timeout (10s)" };
    } else if (error.code === "ECONNREFUSED") {
      return {
        valid: false,
        error: "Connection refused - is the server running?",
      };
    } else {
      return {
        valid: false,
        error: `Token verification failed: ${error.message}`,
      };
    }
  }
}
