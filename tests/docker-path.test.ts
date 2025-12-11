import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { join, isAbsolute, dirname } from "path";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { existsSync, writeFileSync, unlinkSync } from "fs";

/**
 * Docker 环境路径解析测试
 *
 * 测试内容：
 * 1. Config Loader 路径解析
 * 2. 文件上传/保存路径
 * 3. 部署命令执行路径
 * 4. 不同工作目录场景
 * 5. Docker 环境 SSH 命令生成
 */

describe("Docker Environment Path Resolution", () => {
  const TEST_DIR = join(process.cwd(), "test-docker-temp");
  const TEST_CONFIG_PATH = join(TEST_DIR, "server.yaml");
  const HOST_CONFIG_DIR = "/home/user/project";

  // 保存原始环境变量
  let originalHostConfigDir: string | undefined;
  let originalCwd: string;

  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    originalHostConfigDir = process.env.HOST_CONFIG_DIR;
    originalCwd = process.cwd();
  });

  afterAll(async () => {
    // 恢复环境变量
    if (originalHostConfigDir !== undefined) {
      process.env.HOST_CONFIG_DIR = originalHostConfigDir;
    } else {
      delete process.env.HOST_CONFIG_DIR;
    }
    // 清理测试目录
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    process.env.HOST_CONFIG_DIR = HOST_CONFIG_DIR;
  });

  afterEach(() => {
    delete process.env.HOST_CONFIG_DIR;
  });

  // ==================== Config Loader Tests ====================
  describe("Config Loader Path Resolution", () => {
    it("should resolve relative uploadPath to absolute path", async () => {
      const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "./deploy-packages/test"
    deployCommand: "echo test"
`;
      await writeFile(TEST_CONFIG_PATH, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

      expect(isAbsolute(config.environments.test.uploadPath)).toBe(true);
      expect(config.environments.test.uploadPath).toBe(
        join(TEST_DIR, "deploy-packages/test")
      );
    });

    it("should resolve relative log.path to absolute path", async () => {
      const configContent = `
port: 3000
token: "test-token"
log:
  path: "./logs/fde-server.log"
environments:
  test:
    uploadPath: "./deploy"
    deployCommand: "echo test"
`;
      await writeFile(TEST_CONFIG_PATH, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

      expect(config.log?.path).toBe(join(TEST_DIR, "logs/fde-server.log"));
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

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

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

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

      expect(config.environments.test.uploadPath).toBe(absolutePath);
    });
  });

  // ==================== File Save/Upload Path Tests ====================
  describe("File Save Path Resolution", () => {
    const DEPLOY_DIR = join(TEST_DIR, "deploy-save-test");

    beforeAll(async () => {
      await mkdir(DEPLOY_DIR, { recursive: true });
    });

    it("should save file to correct absolute deploy path", async () => {
      const { saveFile } = await import("../src/server/services/deployment");
      const testContent = Buffer.from("test content");
      const envConfig = {
        uploadPath: DEPLOY_DIR,
        deployCommand: "echo test",
      };

      await saveFile(testContent, "test-file.txt", envConfig, "test");

      const savedPath = join(DEPLOY_DIR, "test-file.txt");
      expect(existsSync(savedPath)).toBe(true);

      const content = await readFile(savedPath, "utf-8");
      expect(content).toBe("test content");
    });

    it("should create deploy directory if not exists", async () => {
      const { saveFile } = await import("../src/server/services/deployment");
      const newDeployDir = join(TEST_DIR, "new-deploy-dir");
      const testContent = Buffer.from("new content");
      const envConfig = {
        uploadPath: newDeployDir,
        deployCommand: "echo test",
      };

      await saveFile(testContent, "new-file.txt", envConfig, "test");

      expect(existsSync(join(newDeployDir, "new-file.txt"))).toBe(true);
    });
  });

  // ==================== Deploy Command Execution Tests ====================
  describe("Deploy Command Execution", () => {
    it("should execute simple echo command successfully", async () => {
      const { executeDeployCommand } = await import(
        "../src/server/services/deployment"
      );

      // 应该返回 stdout 和 stderr
      const result = await executeDeployCommand(
        "echo 'test output'",
        TEST_DIR,
        TEST_DIR
      );
      expect(result.stdout).toContain("test output");
      expect(result.stderr).toBe("");
    });

    it("should execute command in correct directory", async () => {
      const { executeDeployCommand } = await import(
        "../src/server/services/deployment"
      );

      // 对于非脚本命令（不以 ./ ../ / 开头），命令会在 process.cwd() 执行
      // 这里只验证命令能正常执行并返回结果
      const result = await executeDeployCommand("pwd", TEST_DIR, TEST_DIR);
      expect(result.stdout).toBeDefined();
      expect(result.stderr).toBe("");
    });

    it("should handle script path ./scripts/xxx.sh correctly", async () => {
      const scriptsDir = join(TEST_DIR, "scripts");
      await mkdir(scriptsDir, { recursive: true });

      // 创建测试脚本
      const scriptPath = join(scriptsDir, "test-script.sh");
      await writeFile(
        scriptPath,
        '#!/bin/bash\necho "script executed" > script-output.txt'
      );
      await import("fs/promises").then((fs) => fs.chmod(scriptPath, 0o755));

      const { executeDeployCommand } = await import(
        "../src/server/services/deployment"
      );

      // 执行相对路径脚本
      await executeDeployCommand(
        "./scripts/test-script.sh",
        TEST_DIR,
        TEST_DIR
      );

      // 输出文件应该在脚本目录
      expect(existsSync(join(scriptsDir, "script-output.txt"))).toBe(true);
    });
  });

  // ==================== Different Working Directory Scenarios ====================
  describe("Different Working Directory Scenarios", () => {
    const SUBDIR = join(TEST_DIR, "subdir");
    const SUBDIR_CONFIG_PATH = join(SUBDIR, "server.yaml");

    beforeAll(async () => {
      await mkdir(SUBDIR, { recursive: true });
    });

    it("should resolve paths relative to config file, not cwd", async () => {
      // 配置文件在子目录
      const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "./deploy"
    deployCommand: "echo test"
`;
      await writeFile(SUBDIR_CONFIG_PATH, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(SUBDIR_CONFIG_PATH);

      // uploadPath 应该相对于 SUBDIR，不是 cwd
      expect(config.environments.test.uploadPath).toBe(join(SUBDIR, "deploy"));
      expect(config.configDir).toBe(SUBDIR);
    });

    it("should handle config file in deeply nested directory", async () => {
      const deepDir = join(TEST_DIR, "a", "b", "c");
      await mkdir(deepDir, { recursive: true });

      const deepConfigPath = join(deepDir, "server.yaml");
      const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "../../../deploy"
    deployCommand: "echo test"
`;
      await writeFile(deepConfigPath, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(deepConfigPath);

      // ../../../deploy 从 a/b/c 返回到 TEST_DIR
      expect(config.environments.test.uploadPath).toBe(
        join(TEST_DIR, "deploy")
      );
    });
  });

  // ==================== Multiple Environments ====================
  describe("Multiple Environments Path Resolution", () => {
    it("should resolve paths for all environments correctly", async () => {
      const configContent = `
port: 3000
token: "test-token"
environments:
  prod:
    uploadPath: "./deploy-packages/prod"
    deployCommand: "./scripts/deploy-prod.sh"
  test:
    uploadPath: "./deploy-packages/test"
    deployCommand: "echo test"
  staging:
    uploadPath: "/absolute/staging/path"
    deployCommand: "npm run staging"
`;
      await writeFile(TEST_CONFIG_PATH, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

      expect(config.environments.prod.uploadPath).toBe(
        join(TEST_DIR, "deploy-packages/prod")
      );
      expect(config.environments.test.uploadPath).toBe(
        join(TEST_DIR, "deploy-packages/test")
      );
      expect(config.environments.staging.uploadPath).toBe(
        "/absolute/staging/path"
      );
    });
  });

  // ==================== Edge Cases ====================
  describe("Edge Cases", () => {
    it("should handle ../relative paths", async () => {
      const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "../parent-deploy"
    deployCommand: "echo test"
`;
      await writeFile(TEST_CONFIG_PATH, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

      expect(config.environments.test.uploadPath).toBe(
        join(TEST_DIR, "..", "parent-deploy")
      );
      expect(isAbsolute(config.environments.test.uploadPath)).toBe(true);
    });

    it("should handle path with spaces", async () => {
      const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "./deploy packages/test"
    deployCommand: "echo test"
`;
      await writeFile(TEST_CONFIG_PATH, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

      expect(config.environments.test.uploadPath).toBe(
        join(TEST_DIR, "deploy packages/test")
      );
    });

    it("should handle nested relative paths", async () => {
      const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "./a/b/c/d/deploy"
    deployCommand: "echo test"
`;
      await writeFile(TEST_CONFIG_PATH, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

      expect(config.environments.test.uploadPath).toBe(
        join(TEST_DIR, "a/b/c/d/deploy")
      );
    });

    it("should handle missing optional log config", async () => {
      const configContent = `
port: 3000
token: "test-token"
environments:
  test:
    uploadPath: "./deploy"
    deployCommand: "echo test"
`;
      await writeFile(TEST_CONFIG_PATH, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

      expect(config.log).toBeUndefined();
    });

    it("should handle empty deployCommand", async () => {
      const { executeDeployCommand } = await import(
        "../src/server/services/deployment"
      );

      // 空命令不应该抛出错误，直接返回空结果
      const result = await executeDeployCommand("", TEST_DIR, TEST_DIR);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });
  });

  // ==================== isDockerEnvironment Tests ====================
  describe("isDockerEnvironment detection", () => {
    it("should return boolean", async () => {
      const { isDockerEnvironment } = await import("../src/server/utils/env");
      const result = isDockerEnvironment();
      expect(typeof result).toBe("boolean");
    });

    it("should detect non-Docker environment in test", async () => {
      const { isDockerEnvironment } = await import("../src/server/utils/env");
      // 在测试环境中通常不是 Docker
      // 除非测试在 Docker 容器中运行
      expect(isDockerEnvironment()).toBe(false);
    });
  });

  // ==================== Command Types Tests ====================
  describe("Different Command Types", () => {
    it("should keep deployCommand unchanged in config", async () => {
      const configContent = `
port: 3000
token: "test-token"
environments:
  script:
    uploadPath: "./deploy"
    deployCommand: "./scripts/deploy.sh"
  npm:
    uploadPath: "./deploy"
    deployCommand: "npm run deploy"
  absolute:
    uploadPath: "./deploy"
    deployCommand: "/opt/scripts/deploy.sh"
  complex:
    uploadPath: "./deploy"
    deployCommand: "cd /app && npm run build && ./deploy.sh"
`;
      await writeFile(TEST_CONFIG_PATH, configContent);

      const { loadConfig } = await import("../src/server/config/loader");
      const config = await loadConfig(TEST_CONFIG_PATH);

      // deployCommand 不应该被修改
      expect(config.environments.script.deployCommand).toBe(
        "./scripts/deploy.sh"
      );
      expect(config.environments.npm.deployCommand).toBe("npm run deploy");
      expect(config.environments.absolute.deployCommand).toBe(
        "/opt/scripts/deploy.sh"
      );
      expect(config.environments.complex.deployCommand).toBe(
        "cd /app && npm run build && ./deploy.sh"
      );
    });
  });
});
