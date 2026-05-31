import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { execSync } from "child_process";
import AdmZip from "adm-zip";
import { assertSafeZipEntries, saveFile } from "../src/server/services/deployment";
import { validateRequest } from "../src/server/services/validation";
import type { ServerConfig } from "../src/server/types";

describe("Security", () => {
  const TEST_DIR = join(process.cwd(), "test-security-temp");
  const DEPLOY_DIR = join(TEST_DIR, "deploy");
  const OUTSIDE_DIR = join(TEST_DIR, "outside");

  const config: ServerConfig = {
    port: 3000,
    token: "secret-token-12345",
    configDir: TEST_DIR,
    environments: {
      test: {
        uploadPath: DEPLOY_DIR,
        deployCommand: "echo test",
      },
    },
  };

  beforeAll(async () => {
    await mkdir(DEPLOY_DIR, { recursive: true });
    await mkdir(OUTSIDE_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("assertSafeZipEntries", () => {
    const baseDir = DEPLOY_DIR;

    it("should allow safe relative entries", () => {
      expect(() =>
        assertSafeZipEntries(
          ["file.txt", "subdir/file.txt", "deep/nested/file.js"],
          baseDir
        )
      ).not.toThrow();
    });

    it("should allow entries that resolve to the base directory", () => {
      expect(() => assertSafeZipEntries(["foo/.."], baseDir)).not.toThrow();
    });

    it("should reject parent directory traversal", () => {
      expect(() => assertSafeZipEntries([".."], baseDir)).toThrow(
        /Zip Slip/
      );
      expect(() => assertSafeZipEntries(["../outside.txt"], baseDir)).toThrow(
        /Zip Slip/
      );
      expect(() =>
        assertSafeZipEntries(["foo/../../outside.txt"], baseDir)
      ).toThrow(/Zip Slip/);
    });

    it("should reject absolute paths", () => {
      expect(() => assertSafeZipEntries(["/etc/passwd"], baseDir)).toThrow(
        /Zip Slip/
      );
    });

    it("should reject backslash traversal paths", () => {
      expect(() =>
        assertSafeZipEntries(["..\\..\\outside.txt"], baseDir)
      ).toThrow(/Zip Slip/);
    });
  });

  describe("validateRequest", () => {
    it("should accept a valid token", () => {
      const result = validateRequest("test", "secret-token-12345", config);
      expect(result.valid).toBe(true);
      expect(result.envConfig?.uploadPath).toBe(DEPLOY_DIR);
    });

    it("should reject an invalid token", () => {
      const result = validateRequest("test", "wrong-token", config);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid token");
    });

    it("should reject tokens with different lengths without leaking validity", () => {
      expect(validateRequest("test", "short", config).valid).toBe(false);
      expect(
        validateRequest("test", "secret-token-12345-extra", config).valid
      ).toBe(false);
    });

    it("should reject missing token", () => {
      const result = validateRequest("test", null, config);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing authorization token");
    });
  });

  describe("saveFile", () => {
    it("should strip path traversal from file names", async () => {
      const content = Buffer.from("safe content");
      await saveFile(content, "../../outside/escaped.txt", config.environments.test, "test");

      const savedPath = join(DEPLOY_DIR, "escaped.txt");
      expect(existsSync(savedPath)).toBe(true);
      expect(await readFile(savedPath, "utf-8")).toBe("safe content");
      expect(existsSync(join(OUTSIDE_DIR, "escaped.txt"))).toBe(false);
    });

    it("should reject invalid file names", async () => {
      await expect(
        saveFile(Buffer.from("x"), "..", config.environments.test, "test")
      ).rejects.toThrow(/Invalid file name/);
      await expect(
        saveFile(Buffer.from("x"), ".", config.environments.test, "test")
      ).rejects.toThrow(/Invalid file name/);
    });
  });

  describe("extractAndDeploy", () => {
    it("should reject zip files with path traversal entries", async () => {
      const { extractAndDeploy } = await import(
        "../src/server/services/deployment"
      );

      const sourceFile = join(OUTSIDE_DIR, "source.txt");
      await writeFile(sourceFile, "malicious");

      const evilZipPath = join(TEST_DIR, "evil.zip");
      execSync(`zip "${evilZipPath}" "../outside/source.txt"`, {
        cwd: DEPLOY_DIR,
      });

      const zipBuffer = await readFile(evilZipPath);

      await expect(
        extractAndDeploy(
          zipBuffer,
          "malicious.zip",
          config.environments.test,
          "test"
        )
      ).rejects.toThrow(/Zip Slip/);

      expect(existsSync(join(OUTSIDE_DIR, "source.txt"))).toBe(true);
      expect(existsSync(join(DEPLOY_DIR, "source.txt"))).toBe(false);
    });

    it("should extract safe zip files", async () => {
      const { extractAndDeploy } = await import(
        "../src/server/services/deployment"
      );

      const zip = new AdmZip();
      zip.addFile("safe.txt", Buffer.from("ok"));
      const zipBuffer = zip.toBuffer();

      await extractAndDeploy(
        zipBuffer,
        "safe.zip",
        config.environments.test,
        "test"
      );

      expect(existsSync(join(DEPLOY_DIR, "safe.txt"))).toBe(true);
      expect(await readFile(join(DEPLOY_DIR, "safe.txt"), "utf-8")).toBe("ok");
    });
  });
});
