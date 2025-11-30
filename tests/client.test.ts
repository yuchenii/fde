import { describe, it, expect } from "bun:test";
import { loadConfig } from "../src/client/config/loader";
import { calculateChecksum, verifyChecksum } from "../src/utils/checksum";
import { existsSync } from "fs";

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
