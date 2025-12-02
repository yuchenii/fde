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
