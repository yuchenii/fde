import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { rm, mkdir, writeFile } from "fs/promises";
import { startServer } from "../src/server/index";
import type { Server } from "bun";

describe("Server API Tests", () => {
  const SERVER_URL = "http://localhost:3000";
  const TEST_TOKEN = "test-secret-key-123";
  const TEST_DIR = join(process.cwd(), "test-temp");
  const TEST_CONFIG_PATH = join(process.cwd(), "test-server-config.yaml");
  let server: Server<any>;

  beforeAll(async () => {
    // 创建测试目录
    await mkdir(TEST_DIR, { recursive: true });

    // 创建测试配置文件
    const configContent = `
port: 3000
token: "${TEST_TOKEN}"
environments:
  test:
    uploadPath: "${TEST_DIR}/test"
    deployCommand: "echo 'test deployed'"
`;
    await writeFile(TEST_CONFIG_PATH, configContent);

    // 启动服务器
    server = await startServer(TEST_CONFIG_PATH);
  });

  afterAll(async () => {
    // 停止服务器
    if (server) {
      server.stop();
    }

    // 清理测试目录和配置文件
    await rm(TEST_DIR, { recursive: true, force: true });
    await rm(TEST_CONFIG_PATH, { force: true });
  });

  describe("Health Check", () => {
    it("should respond to ping", async () => {
      const response = await fetch(`${SERVER_URL}/ping`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("pong");
    });

    it("should return health status", async () => {
      const response = await fetch(`${SERVER_URL}/health`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe("ok");
      expect(data.version).toBeDefined();
      expect(data.environments).toBeArray();
    });
  });

  describe("Authentication", () => {
    it("should reject requests without token", async () => {
      const formData = new FormData();
      formData.append("env", "test");
      formData.append("file", new Blob(["test"]), "test.txt");

      const response = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("token");
    });

    it("should reject requests with invalid token", async () => {
      const formData = new FormData();
      formData.append("env", "test");
      formData.append("file", new Blob(["test"]), "test.txt");

      const response = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        headers: {
          authorization: "invalid-token",
        },
        body: formData,
      });

      expect(response.status).toBe(403);
    });

    it("should accept requests with valid token", async () => {
      const formData = new FormData();
      formData.append("env", "test");
      formData.append("shouldExtract", "false");
      formData.append("file", new Blob(["test content"]), "test.txt");

      const response = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
        },
        body: formData,
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Token Verification", () => {
    it("should verify valid token", async () => {
      const response = await fetch(`${SERVER_URL}/verify`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ env: "test" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.env).toBe("test");
    });

    it("should reject invalid token", async () => {
      const response = await fetch(`${SERVER_URL}/verify`, {
        method: "POST",
        headers: {
          authorization: "wrong-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ env: "test" }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("token");
    });

    it("should reject unknown environment", async () => {
      const response = await fetch(`${SERVER_URL}/verify`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ env: "unknown" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("environment");
    });
  });

  describe("File Upload", () => {
    it("should upload a file successfully", async () => {
      const testContent = "Hello, World!";
      const formData = new FormData();
      formData.append("env", "test");
      formData.append("shouldExtract", "false");
      formData.append("file", new Blob([testContent]), "hello.txt");

      const response = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
        },
        body: formData,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it("should reject upload without environment", async () => {
      const formData = new FormData();
      formData.append("file", new Blob(["test"]), "test.txt");

      const response = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("environment");
    });

    it("should reject upload without file", async () => {
      const formData = new FormData();
      formData.append("env", "test");

      const response = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
        },
        body: formData,
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("file");
    });
  });

  describe("Stream Upload", () => {
    it("should handle streaming upload", async () => {
      const testContent = "Streaming test content";
      const blob = new Blob([testContent]);

      const response = await fetch(
        `${SERVER_URL}/upload-stream?env=test&fileName=stream-test.txt&shouldExtract=false`,
        {
          method: "POST",
          headers: {
            authorization: TEST_TOKEN,
          },
          body: blob,
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Deployment", () => {
    it("should trigger deployment", async () => {
      const response = await fetch(`${SERVER_URL}/deploy`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          env: "test",
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Deployment Failure", () => {
    const FAIL_SERVER_URL = "http://localhost:3001";
    const FAIL_TOKEN = "fail-test-token";
    const FAIL_CONFIG_PATH = join(process.cwd(), "test-fail-config.yaml");
    let failServer: Server<any>;

    beforeAll(async () => {
      // 创建会失败的部署命令配置
      const configContent = `
port: 3001
token: "${FAIL_TOKEN}"
environments:
  fail-test:
    uploadPath: "${TEST_DIR}/fail-test"
    deployCommand: "echo 'Starting...' && echo 'Error occurred' >&2 && exit 1"
`;
      await writeFile(FAIL_CONFIG_PATH, configContent);
      failServer = await startServer(FAIL_CONFIG_PATH);
    });

    afterAll(async () => {
      if (failServer) {
        failServer.stop();
      }
      await rm(FAIL_CONFIG_PATH, { force: true });
    });

    it("should return detailed error output when deploy command fails", async () => {
      const response = await fetch(`${FAIL_SERVER_URL}/deploy`, {
        method: "POST",
        headers: {
          authorization: FAIL_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          env: "fail-test",
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();

      // 验证错误响应包含详细输出
      expect(data.error).toBe("Deploy command failed");
      expect(data.stdout).toContain("Starting...");
      expect(data.stderr).toContain("Error occurred");
      expect(data.exitCode).toBe(1);
    });
  });
});
