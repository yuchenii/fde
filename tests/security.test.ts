import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdir, rm, readFile, symlink, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { execSync } from "child_process";
import AdmZip from "adm-zip";
import {
  assertSafeZipEntries,
  assertSafeZipEntryTypes,
  assertNoSymlinkTargets,
  saveFile,
} from "../src/server/services/deployment";
import {
  clearAuthFailures,
  getAuthRetryAfter,
  recordAuthFailure,
  validateRequest,
} from "../src/server/services/validation";
import {
  deleteUpload,
  getUploadReservationSize,
  getUploadStatus,
  initUpload,
  MAX_CHUNK_SIZE,
  MAX_TOTAL_CHUNKS,
  mergeChunks,
  releaseUploadCompletion,
  saveChunk,
} from "../src/server/services/chunkStorage";
import {
  readJsonBody,
  readRequestBody,
} from "../src/server/utils/request";
import {
  claimStandardUpload,
  releaseStandardUpload,
} from "../src/server/routes/handlers";
import { getExpectedChecksum } from "../src/utils/selfUpdate";
import type { ServerConfig } from "../src/server/types";

describe("Security", () => {
  const TEST_DIR = join(process.cwd(), "test-security-temp");
  const DEPLOY_DIR = join(TEST_DIR, "deploy");
  const OUTSIDE_DIR = join(TEST_DIR, "outside");
  const STORAGE_TEST_ID = `security-${Date.now()}`;
  const STORAGE_ENV_A = `security-a-${Date.now()}`;
  const STORAGE_ENV_B = `security-b-${Date.now()}`;

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
    await deleteUpload(STORAGE_ENV_A, STORAGE_TEST_ID);
    await deleteUpload(STORAGE_ENV_B, STORAGE_TEST_ID);
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

    it("should reject internal parent-directory segments", () => {
      expect(() => assertSafeZipEntries(["foo/.."], baseDir)).toThrow(
        /Zip Slip/
      );
      expect(() =>
        assertSafeZipEntries(["new/../existing-link/file"], baseDir)
      ).toThrow(/Zip Slip/);
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

    it("should reject existing symbolic-link targets", async () => {
      if (process.platform === "win32") return;
      const link = join(DEPLOY_DIR, "existing-link");
      await symlink(OUTSIDE_DIR, link);
      await expect(
        assertNoSymlinkTargets(["existing-link/file.txt"], DEPLOY_DIR)
      ).rejects.toThrow(/symbolic link/);
      await rm(link, { force: true });
    });
  });

  describe("assertSafeZipEntryTypes", () => {
    it("should allow regular files and directories", () => {
      expect(() =>
        assertSafeZipEntryTypes(
          "-rw-r--r--  3.0 unx 4 tx 4 stor file.txt\n" +
            "drwxr-xr-x  3.0 unx 0 bx 0 stor directory/"
        )
      ).not.toThrow();
    });

    it("should reject symbolic links", () => {
      expect(() =>
        assertSafeZipEntryTypes(
          "lrwxr-xr-x  3.0 unx 4 bx 4 stor unsafe-link"
        )
      ).toThrow(/symbolic link/);
    });

    it("should reject archives over the extraction limit", () => {
      expect(() =>
        assertSafeZipEntryTypes(
          "-rw-r--r--  3.0 unx 5 tx 5 stor large.txt",
          4
        )
      ).toThrow(/extraction limit/);
    });

    it("should enforce the fixed archive entry limit", () => {
      expect(() =>
        assertSafeZipEntryTypes(
          "Zip file size: 1 bytes, number of entries: 100001"
        )
      ).toThrow(/entry limit/);
    });

    it("should reject unparsed archive entries", () => {
      expect(() =>
        assertSafeZipEntryTypes(
          "Zip file size: 1 bytes, number of entries: 1\nunsupported"
        )
      ).toThrow(/unsupported entry type/);
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

    it("should lock a client after five authentication failures", () => {
      const clientId = `security-client-${Date.now()}`;
      for (let i = 0; i < 5; i++) recordAuthFailure(clientId);
      expect(getAuthRetryAfter(clientId)).toBeGreaterThan(0);
      clearAuthFailures(clientId);
      expect(getAuthRetryAfter(clientId)).toBe(0);
    });
  });

  describe("request body limits", () => {
    it("should enforce the limit while reading the body", async () => {
      const request = new Request("http://localhost/upload", {
        method: "POST",
        body: "12345",
      });
      await expect(readRequestBody(request, 4)).rejects.toMatchObject({
        status: 413,
      });
    });

    it("should reject invalid JSON", async () => {
      const request = new Request("http://localhost/deploy", {
        method: "POST",
        body: "not-json",
      });
      await expect(readJsonBody(request)).rejects.toMatchObject({ status: 400 });
    });

    it("should allow only one standard upload at a time", () => {
      expect(claimStandardUpload()).toBe(true);
      expect(claimStandardUpload()).toBe(false);
      releaseStandardUpload();
      expect(claimStandardUpload()).toBe(true);
      releaseStandardUpload();
    });
  });

  describe("release checksums", () => {
    it("should select the checksum for the exact asset name", () => {
      const first = "a".repeat(64);
      const second = "b".repeat(64);
      const manifest = `${first}  fde-client-linux-x64\n${second}  fde-server-linux-x64`;
      expect(getExpectedChecksum(manifest, "fde-server-linux-x64")).toBe(
        second
      );
      expect(() => getExpectedChecksum(manifest, "missing")).toThrow(
        /Checksum not found/
      );
    });
  });

  describe("chunk storage", () => {
    it("should allow uploads larger than the former 1 GiB limit", async () => {
      expect(MAX_TOTAL_CHUNKS).toBeGreaterThan(1024);
      const largeId = `${STORAGE_TEST_ID}-large`;
      await initUpload(largeId, 1025, STORAGE_ENV_A, false, "large.bin");
      await deleteUpload(STORAGE_ENV_A, largeId);
    });

    it("should reserve capacity for zero-chunk tasks", async () => {
      expect(getUploadReservationSize(0)).toBe(MAX_CHUNK_SIZE);
      const emptyId = `${STORAGE_TEST_ID}-empty`;
      await initUpload(emptyId, 0, STORAGE_ENV_A, false, "empty.txt");
      const merged = await mergeChunks(STORAGE_ENV_A, emptyId);
      try {
        expect(merged.size).toBe(0);
      } finally {
        releaseUploadCompletion(STORAGE_ENV_A, emptyId);
        await rm(merged.tempDir, { recursive: true, force: true });
        await deleteUpload(STORAGE_ENV_A, emptyId);
      }
    });

    it("should reject path traversal IDs", async () => {
      await expect(
        initUpload("../escape", 1, STORAGE_ENV_A, false, "file.txt")
      ).rejects.toThrow(/Invalid uploadId/);
    });

    it("should isolate the same upload ID by environment", async () => {
      await initUpload(
        STORAGE_TEST_ID,
        1,
        STORAGE_ENV_A,
        false,
        "a.txt"
      );
      await initUpload(
        STORAGE_TEST_ID,
        1,
        STORAGE_ENV_B,
        false,
        "b.txt"
      );
      await saveChunk(
        STORAGE_ENV_A,
        STORAGE_TEST_ID,
        0,
        Buffer.from("env-a")
      );
      await saveChunk(
        STORAGE_ENV_B,
        STORAGE_TEST_ID,
        0,
        Buffer.from("env-b")
      );

      expect((await getUploadStatus(STORAGE_ENV_A, STORAGE_TEST_ID)).exists).toBe(
        true
      );
      const mergedA = await mergeChunks(STORAGE_ENV_A, STORAGE_TEST_ID);
      const mergedB = await mergeChunks(STORAGE_ENV_B, STORAGE_TEST_ID);
      try {
        expect(await readFile(mergedA.filePath, "utf-8")).toBe("env-a");
        expect(await readFile(mergedB.filePath, "utf-8")).toBe("env-b");
        await expect(
          mergeChunks(STORAGE_ENV_A, STORAGE_TEST_ID)
        ).rejects.toThrow(/already in progress/);
        await expect(
          saveChunk(
            STORAGE_ENV_A,
            STORAGE_TEST_ID,
            0,
            Buffer.from("late")
          )
        ).rejects.toThrow(/already in progress/);
        await expect(
          deleteUpload(STORAGE_ENV_A, STORAGE_TEST_ID)
        ).rejects.toThrow(/already in progress/);
      } finally {
        releaseUploadCompletion(STORAGE_ENV_A, STORAGE_TEST_ID);
        releaseUploadCompletion(STORAGE_ENV_B, STORAGE_TEST_ID);
        await rm(mergedA.tempDir, { recursive: true, force: true });
        await rm(mergedB.tempDir, { recursive: true, force: true });
      }
    });

    it("should reject conflicting metadata and invalid chunks", async () => {
      await expect(
        initUpload(
          STORAGE_TEST_ID,
          2,
          STORAGE_ENV_A,
          false,
          "different.txt"
        )
      ).rejects.toThrow(/different metadata/);
      await expect(
        saveChunk(
          STORAGE_ENV_A,
          STORAGE_TEST_ID,
          1,
          Buffer.from("out-of-range")
        )
      ).rejects.toThrow(/outside the initialized upload range/);
      await expect(
        saveChunk(
          STORAGE_ENV_A,
          STORAGE_TEST_ID,
          0,
          Buffer.alloc(MAX_CHUNK_SIZE + 1)
        )
      ).rejects.toThrow(/exceeds/);
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

    it("should reject an existing symbolic-link target", async () => {
      if (process.platform === "win32") return;
      const outsideFile = join(OUTSIDE_DIR, "linked-target.txt");
      const link = join(DEPLOY_DIR, "linked-file.txt");
      await writeFile(outsideFile, "original");
      await symlink(outsideFile, link);

      await expect(
        saveFile(
          Buffer.from("overwritten"),
          "linked-file.txt",
          config.environments.test,
          "test"
        )
      ).rejects.toThrow(/symbolic link/);
      expect(await readFile(outsideFile, "utf-8")).toBe("original");
      await rm(link, { force: true });
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

    it("should reject zip files containing symbolic links", async () => {
      if (process.platform === "win32") return;

      const sourceDir = join(TEST_DIR, "symlink-source");
      const zipPath = join(TEST_DIR, "symlink.zip");
      await mkdir(sourceDir, { recursive: true });
      await symlink(OUTSIDE_DIR, join(sourceDir, "unsafe-link"));
      execSync(`zip -yr "${zipPath}" unsafe-link`, { cwd: sourceDir });

      await expect(
        (async () => {
          const zipBuffer = await readFile(zipPath);
          const { extractAndDeploy } = await import(
            "../src/server/services/deployment"
          );
          await extractAndDeploy(
            zipBuffer,
            "symlink.zip",
            config.environments.test,
            "test"
          );
        })()
      ).rejects.toThrow(/symbolic link/);
    });
  });
});
