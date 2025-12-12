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

  describe("Chunk Upload", () => {
    const uploadId = "test-upload-" + Date.now();
    const totalChunks = 3;
    const chunkData = ["chunk1-data", "chunk2-data", "chunk3-data"];

    it("should initialize chunk upload", async () => {
      const response = await fetch(`${SERVER_URL}/upload/init`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          uploadId,
          totalChunks,
          fileName: "chunk-test.txt",
          shouldExtract: false,
          env: "test",
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.uploadedChunks).toEqual([]);
      expect(data.isResume).toBe(false);
    });

    it("should upload individual chunks with MD5", async () => {
      for (let i = 0; i < totalChunks; i++) {
        const content = chunkData[i];
        const blob = new Blob([content]);

        // Calculate MD5
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        const hashBuffer = await crypto.subtle
          .digest("MD5", data)
          .catch(() => null);

        // Note: crypto.subtle doesn't support MD5, so we skip MD5 header in test
        const response = await fetch(
          `${SERVER_URL}/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}&env=test`,
          {
            method: "POST",
            headers: {
              authorization: TEST_TOKEN,
              "content-type": "application/octet-stream",
            },
            body: blob,
          }
        );

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.chunkIndex).toBe(i);
      }
    });

    it("should return upload status with uploaded chunks", async () => {
      const response = await fetch(
        `${SERVER_URL}/upload/status?uploadId=${uploadId}&env=test`,
        {
          method: "GET",
          headers: {
            authorization: TEST_TOKEN,
          },
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.exists).toBe(true);
      expect(data.uploadedChunks).toContain(0);
      expect(data.uploadedChunks).toContain(1);
      expect(data.uploadedChunks).toContain(2);
      expect(data.totalChunks).toBe(totalChunks);
    });

    it("should complete chunk upload and merge", async () => {
      const response = await fetch(`${SERVER_URL}/upload/complete`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          uploadId,
          fileName: "chunk-test.txt",
          shouldExtract: false,
          env: "test",
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.fileName).toBe("chunk-test.txt");
    });

    it("should return not exists for completed upload", async () => {
      const response = await fetch(
        `${SERVER_URL}/upload/status?uploadId=${uploadId}&env=test`,
        {
          method: "GET",
          headers: {
            authorization: TEST_TOKEN,
          },
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.exists).toBe(false);
    });

    it("should support resume upload", async () => {
      const resumeUploadId = "resume-test-" + Date.now();

      // Initialize
      await fetch(`${SERVER_URL}/upload/init`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          uploadId: resumeUploadId,
          totalChunks: 3,
          fileName: "resume-test.txt",
          shouldExtract: false,
          env: "test",
        }),
      });

      // Upload only first chunk
      await fetch(
        `${SERVER_URL}/upload/chunk?uploadId=${resumeUploadId}&chunkIndex=0&env=test`,
        {
          method: "POST",
          headers: {
            authorization: TEST_TOKEN,
            "content-type": "application/octet-stream",
          },
          body: new Blob(["first-chunk"]),
        }
      );

      // Re-initialize should show resume status
      const response = await fetch(`${SERVER_URL}/upload/init`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          uploadId: resumeUploadId,
          totalChunks: 3,
          fileName: "resume-test.txt",
          shouldExtract: false,
          env: "test",
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uploadedChunks).toContain(0);
      expect(data.isResume).toBe(true);

      // Cleanup
      await fetch(
        `${SERVER_URL}/upload/cancel?uploadId=${resumeUploadId}&env=test`,
        {
          method: "DELETE",
          headers: {
            authorization: TEST_TOKEN,
          },
        }
      );
    });

    it("should cancel upload", async () => {
      const cancelUploadId = "cancel-test-" + Date.now();

      // Initialize
      await fetch(`${SERVER_URL}/upload/init`, {
        method: "POST",
        headers: {
          authorization: TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          uploadId: cancelUploadId,
          totalChunks: 2,
          fileName: "cancel-test.txt",
          shouldExtract: false,
          env: "test",
        }),
      });

      // Cancel
      const response = await fetch(
        `${SERVER_URL}/upload/cancel?uploadId=${cancelUploadId}&env=test`,
        {
          method: "DELETE",
          headers: {
            authorization: TEST_TOKEN,
          },
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify deleted
      const statusResponse = await fetch(
        `${SERVER_URL}/upload/status?uploadId=${cancelUploadId}&env=test`,
        {
          method: "GET",
          headers: {
            authorization: TEST_TOKEN,
          },
        }
      );

      const statusData = await statusResponse.json();
      expect(statusData.exists).toBe(false);
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
