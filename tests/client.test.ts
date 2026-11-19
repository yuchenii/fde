import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { loadConfig } from "../src/client/config/loader";
import { triggerDeploy } from "../src/client/services/deploy";
import { loadConfig as loadServerConfig } from "../src/server/config/loader";
import { calculateChecksum, verifyChecksum } from "../src/utils/checksum";
import { existsSync } from "fs";
import { join, isAbsolute, dirname, resolve } from "path";
import { mkdir, writeFile, rm } from "fs/promises";

describe("Client Utils Tests", () => {
  describe("Config Loader", () => {
    it("should load config file", async () => {
      const config = await loadConfig("./deploy.yaml");

      expect(config).toBeDefined();
      expect(config.environments).toBeDefined();
      expect(Object.keys(config.environments).length).toBeGreaterThan(0);
    });

    it("should throw error for non-existent config", async () => {
      try {
        await loadConfig("./non-existent.yaml");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it("should validate environment structure", async () => {
      const config = await loadConfig("./deploy.yaml");
      const env = Object.values(config.environments)[0];

      expect(env.serverUrl).toBeDefined();
      expect(env.token).toBeDefined();
      expect(env.localPath).toBeDefined();
    });

    it("should set configDir", async () => {
      const config = await loadConfig("./deploy.yaml");
      expect(config.configDir).toBeDefined();
      expect(isAbsolute(config.configDir)).toBe(true);
    });

    it("should resolve relative localPath to absolute path", async () => {
      const config = await loadConfig("./deploy.yaml");
      const env = Object.values(config.environments)[0];

      // localPath should be an absolute path
      expect(isAbsolute(env.localPath)).toBe(true);
    });
  });

  describe("Path Detection", () => {
    it("should detect file exists", () => {
      const exists = existsSync("./package.json");
      expect(exists).toBe(true);
    });

    it("should detect directory exists", () => {
      const exists = existsSync("./src");
      expect(exists).toBe(true);
    });

    it("should detect non-existent path", () => {
      const exists = existsSync("./does-not-exist");
      expect(exists).toBe(false);
    });
  });
});

describe("Deploy result confirmation", () => {
  it("only accepts a fallback result for the deployment that lost its stream", async () => {
    const fetchMock = spyOn(globalThis, "fetch");
    const realTimeout = globalThis.setTimeout;
    const timer = spyOn(globalThis, "setTimeout").mockImplementation((callback) => realTimeout(callback, 0));
    try {
      for (const statusId of ["original", "later"]) {
        let requests = 0;
        fetchMock.mockImplementation(async (url, init) => {
          const headers = new Headers(init?.headers);
          if (++requests === 1) {
            return new Response('id: 1\nevent: output\ndata: {"data":""}\n\nid: 2\n', {
              headers: { "X-Deployment-ID": "original" },
            });
          }
          expect(headers.get("x-deployment-id")).toBe("original");
          if (String(url).includes("/deploy/status?")) {
            return Response.json({ deploymentId: statusId, lastResult: { success: true, exitCode: 0 } });
          }
          expect(headers.get("last-event-id")).toBe("1");
          return new Response(null, { status: 503 });
        });
        const result = triggerDeploy("http://localhost", "test", "test-token");
        if (statusId === "original") {
          expect(await result).toMatchObject({ success: true });
        } else {
          await expect(result).rejects.toThrow("Cannot confirm deployment result");
        }
        expect(requests).toBe(5);
      }
    } finally {
      timer.mockRestore();
      fetchMock.mockRestore();
    }
  });

  it("reads a split done event from an older server and rejects an incomplete stream", async () => {
    const fetchMock = spyOn(globalThis, "fetch");
    try {
      const encoder = new TextEncoder();
      fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("id: 1\nevent: done\n"));
          controller.enqueue(encoder.encode('data: {"success":true,"exitCode":0}\n\n'));
          controller.close();
        },
      }))).mockResolvedValueOnce(new Response("id: 1\nevent: output\n"));
      expect(await triggerDeploy("http://localhost", "test", "test-token")).toMatchObject({ success: true });
      await expect(triggerDeploy("http://localhost", "test", "test-token")).rejects.toThrow("before a final event");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe("Server Config Loader Tests", () => {
  const TEST_DIR = join(process.cwd(), "test-config-temp");
  const TEST_CONFIG_PATH = join(TEST_DIR, "server.yaml");

  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should resolve relative uploadPath to absolute path", async () => {
    const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "./deploy-test"
    deployCommand: "echo test"
`;
    await writeFile(TEST_CONFIG_PATH, configContent);

    const config = await loadServerConfig(TEST_CONFIG_PATH);
    const env = config.environments.test;

    expect(isAbsolute(env.uploadPath)).toBe(true);
    expect(env.uploadPath).toBe(join(TEST_DIR, "deploy-test"));
  });

  it("should resolve relative log.path to absolute path", async () => {
    const configContent = `
port: 3000
token: "test-token"
log:
  path: "./logs/server.log"
environments:
  test:
    uploadPath: "./deploy"
    deployCommand: "echo test"
`;
    await writeFile(TEST_CONFIG_PATH, configContent);

    const config = await loadServerConfig(TEST_CONFIG_PATH);

    expect(config.log?.path).toBeDefined();
    expect(isAbsolute(config.log!.path!)).toBe(true);
    expect(config.log!.path).toBe(join(TEST_DIR, "logs/server.log"));
  });

  it("should set configDir to config file directory", async () => {
    const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "./deploy"
    deployCommand: "echo test"
`;
    await writeFile(TEST_CONFIG_PATH, configContent);

    const config = await loadServerConfig(TEST_CONFIG_PATH);

    expect(config.configDir).toBeDefined();
    expect(config.configDir).toBe(TEST_DIR);
  });

  it("should not modify absolute paths", async () => {
    const absolutePath = "/absolute/path/to/deploy";
    const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "${absolutePath}"
    deployCommand: "echo test"
`;
    await writeFile(TEST_CONFIG_PATH, configContent);

    const config = await loadServerConfig(TEST_CONFIG_PATH);
    const env = config.environments.test;

    expect(env.uploadPath).toBe(absolutePath);
  });

  it("should load limits in MB and reject expressions", async () => {
    const configContent = `
port: 3000
limits:
  chunkStorageMB: 2048
  chunkFileMB: 1024
  zipExtractMB: 512
environments:
  test:
    uploadPath: "./deploy"
    deployCommand: "echo test"
`;
    await writeFile(TEST_CONFIG_PATH, configContent);

    const config = await loadServerConfig(TEST_CONFIG_PATH);
    expect(config.limits).toEqual({
      chunkStorageMB: 2048,
      chunkFileMB: 1024,
      zipExtractMB: 512,
    });

    await writeFile(
      TEST_CONFIG_PATH,
      configContent.replace("2048", "1024*2")
    );
    await expect(loadServerConfig(TEST_CONFIG_PATH)).rejects.toThrow(
      /Failed to load config/
    );
  });
});

describe("Checksum Utility", () => {
  it("should calculate SHA256 checksum", () => {
    const testData = Buffer.from("Hello, World!");

    const checksum = calculateChecksum(testData);

    expect(checksum).toBeDefined();
    expect(checksum).toBeString();
    expect(checksum.length).toBe(64); // SHA256 = 64 hex characters
  });

  it("should verify checksum", () => {
    const testData = Buffer.from("Test data");
    const checksum = calculateChecksum(testData);

    const isValid = verifyChecksum(testData, checksum);
    expect(isValid).toBe(true);
  });

  it("should detect invalid checksum", () => {
    const testData = Buffer.from("Test data");
    const invalidChecksum = "0".repeat(64);

    const isValid = verifyChecksum(testData, invalidChecksum);
    expect(isValid).toBe(false);
  });
});
