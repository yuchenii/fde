import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { loadConfig } from "../src/client/config/loader";
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
      expect(env.authToken).toBeDefined();
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

describe("Server Config Loader Tests", () => {
  const TEST_DIR = join(process.cwd(), "test-config-temp");
  const TEST_CONFIG_PATH = join(TEST_DIR, "server.yaml");

  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should resolve relative deployPath to absolute path", async () => {
    const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    deployPath: "./deploy-test"
    deployCommand: "echo test"
`;
    await writeFile(TEST_CONFIG_PATH, configContent);

    const config = await loadServerConfig(TEST_CONFIG_PATH);
    const env = config.environments.test;

    expect(isAbsolute(env.deployPath)).toBe(true);
    expect(env.deployPath).toBe(join(TEST_DIR, "deploy-test"));
  });

  it("should resolve relative log.path to absolute path", async () => {
    const configContent = `
port: 3000
token: "test-token"
log:
  path: "./logs/server.log"
environments:
  test:
    deployPath: "./deploy"
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
    deployPath: "./deploy"
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
    deployPath: "${absolutePath}"
    deployCommand: "echo test"
`;
    await writeFile(TEST_CONFIG_PATH, configContent);

    const config = await loadServerConfig(TEST_CONFIG_PATH);
    const env = config.environments.test;

    expect(env.deployPath).toBe(absolutePath);
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
