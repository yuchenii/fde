import { describe, it, expect, beforeEach, mock } from "bun:test";
import { buildEnv, mergeEnvConfig, type EnvConfig } from "../src/utils/env";

describe("Env Utils Tests", () => {
  // matchesPattern 测试（通过 buildEnv 间接测试）
  describe("matchesPattern (glob and regex)", () => {
    it("should match exact variable name", () => {
      const env = buildEnv({
        mode: "isolate",
        include: ["MY_VAR"],
      });
      // 设置测试变量
      process.env.MY_VAR = "test";
      const result = buildEnv({ mode: "isolate", include: ["MY_VAR"] });
      expect(result.MY_VAR).toBe("test");
      delete process.env.MY_VAR;
    });

    it("should match prefix wildcard (VITE_*)", () => {
      process.env.VITE_APP_NAME = "test-app";
      process.env.VITE_PORT = "3000";
      process.env.OTHER_VAR = "other";

      const env = buildEnv({ mode: "isolate", include: ["VITE_*"] });

      expect(env.VITE_APP_NAME).toBe("test-app");
      expect(env.VITE_PORT).toBe("3000");
      expect(env.OTHER_VAR).toBeUndefined();

      delete process.env.VITE_APP_NAME;
      delete process.env.VITE_PORT;
      delete process.env.OTHER_VAR;
    });

    it("should match suffix wildcard (*_SECRET)", () => {
      process.env.DB_SECRET = "db-secret";
      process.env.API_SECRET = "api-secret";
      process.env.NOT_MATCHED = "nope";

      const env = buildEnv({ mode: "isolate", include: ["*_SECRET"] });

      expect(env.DB_SECRET).toBe("db-secret");
      expect(env.API_SECRET).toBe("api-secret");
      expect(env.NOT_MATCHED).toBeUndefined();

      delete process.env.DB_SECRET;
      delete process.env.API_SECRET;
      delete process.env.NOT_MATCHED;
    });

    it("should match contains wildcard (*DEBUG*)", () => {
      process.env.MY_DEBUG_VAR = "debug1";
      process.env.DEBUG_LEVEL = "debug2";
      process.env.SOME_VAR = "nope";

      const env = buildEnv({ mode: "isolate", include: ["*DEBUG*"] });

      expect(env.MY_DEBUG_VAR).toBe("debug1");
      expect(env.DEBUG_LEVEL).toBe("debug2");
      expect(env.SOME_VAR).toBeUndefined();

      delete process.env.MY_DEBUG_VAR;
      delete process.env.DEBUG_LEVEL;
      delete process.env.SOME_VAR;
    });

    it("should match raw regex pattern (/^VITE_\\d+$/)", () => {
      process.env.VITE_123 = "num-match";
      process.env.VITE_ABC = "no-match";

      const env = buildEnv({ mode: "isolate", include: ["/^VITE_\\d+$/"] });

      expect(env.VITE_123).toBe("num-match");
      expect(env.VITE_ABC).toBeUndefined();

      delete process.env.VITE_123;
      delete process.env.VITE_ABC;
    });

    it("should support regex flags (/pattern/i for case-insensitive)", () => {
      process.env.my_secret = "lowercase";
      process.env.MY_SECRET = "uppercase";
      process.env.My_Secret = "mixedcase";

      // Case-insensitive match
      const env = buildEnv({ mode: "isolate", include: ["/^my_secret$/i"] });

      expect(env.my_secret).toBe("lowercase");
      expect(env.MY_SECRET).toBe("uppercase");
      expect(env.My_Secret).toBe("mixedcase");

      delete process.env.my_secret;
      delete process.env.MY_SECRET;
      delete process.env.My_Secret;
    });

    it("should warn and not match on invalid regex", () => {
      const warnSpy = mock(() => { });
      const originalWarn = console.warn;
      console.warn = warnSpy;

      process.env.TEST_VAR = "test";
      const env = buildEnv({ mode: "isolate", include: ["/[invalid/"] });

      expect(env.TEST_VAR).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();

      console.warn = originalWarn;
      delete process.env.TEST_VAR;
    });

    it("should escape special regex characters in glob mode", () => {
      process.env["VAR.NAME"] = "dot-name";
      process.env["VAR+NAME"] = "plus-name";

      // 精确匹配包含特殊字符的变量名
      const env = buildEnv({ mode: "isolate", include: ["VAR.NAME", "VAR+NAME"] });

      expect(env["VAR.NAME"]).toBe("dot-name");
      expect(env["VAR+NAME"]).toBe("plus-name");

      delete process.env["VAR.NAME"];
      delete process.env["VAR+NAME"];
    });
  });

  // mergeEnvConfig 测试
  describe("mergeEnvConfig", () => {
    it("should use default mode when not specified", () => {
      const result = mergeEnvConfig(undefined, undefined);
      expect(result.mode).toBe("inherit");
    });

    it("should prioritize envLevel mode over topLevel", () => {
      const topLevel: EnvConfig = { mode: "inherit" };
      const envLevel: EnvConfig = { mode: "isolate" };

      const result = mergeEnvConfig(topLevel, envLevel);
      expect(result.mode).toBe("isolate");
    });

    it("should concatenate exclude arrays", () => {
      const topLevel: EnvConfig = { exclude: ["A", "B"] };
      const envLevel: EnvConfig = { exclude: ["C", "D"] };

      const result = mergeEnvConfig(topLevel, envLevel);
      expect(result.exclude).toEqual(["A", "B", "C", "D"]);
    });

    it("should concatenate include arrays", () => {
      const topLevel: EnvConfig = { include: ["X"] };
      const envLevel: EnvConfig = { include: ["Y"] };

      const result = mergeEnvConfig(topLevel, envLevel);
      expect(result.include).toEqual(["X", "Y"]);
    });

    it("should merge custom with envLevel overriding topLevel", () => {
      const topLevel: EnvConfig = {
        custom: { KEY1: "top-val", KEY2: "top-only" },
      };
      const envLevel: EnvConfig = {
        custom: { KEY1: "env-val", KEY3: "env-only" },
      };

      const result = mergeEnvConfig(topLevel, envLevel);
      expect(result.custom).toEqual({
        KEY1: "env-val", // envLevel overrides
        KEY2: "top-only",
        KEY3: "env-only",
      });
    });

    it("should handle undefined inputs gracefully", () => {
      const result = mergeEnvConfig(undefined, { mode: "isolate" });
      expect(result.mode).toBe("isolate");
      expect(result.exclude).toEqual([]);
      expect(result.include).toEqual([]);
      expect(result.custom).toEqual({});
    });
  });

  // buildEnv 测试
  describe("buildEnv", () => {
    beforeEach(() => {
      // 清理测试变量
      delete process.env.TEST_VAR;
      delete process.env.VITE_TEST;
    });

    describe("inherit mode", () => {
      it("should inherit process.env by default", () => {
        process.env.TEST_VAR = "test-value";

        const env = buildEnv({ mode: "inherit" });

        expect(env.TEST_VAR).toBe("test-value");
        expect(env.PATH).toBeDefined(); // 系统变量应保留

        delete process.env.TEST_VAR;
      });

      it("should exclude VITE_* by default", () => {
        process.env.VITE_TEST = "should-be-excluded";
        process.env.OTHER_VAR = "should-be-kept";

        const env = buildEnv({ mode: "inherit" });

        expect(env.VITE_TEST).toBeUndefined();
        expect(env.OTHER_VAR).toBe("should-be-kept");

        delete process.env.VITE_TEST;
        delete process.env.OTHER_VAR;
      });

      it("should exclude NODE_ENV by default", () => {
        process.env.NODE_ENV = "development";

        const env = buildEnv({ mode: "inherit" });

        expect(env.NODE_ENV).toBeUndefined();
      });

      it("should apply user exclude patterns", () => {
        process.env.DEBUG_VAR = "debug";
        process.env.NORMAL_VAR = "normal";

        const env = buildEnv({
          mode: "inherit",
          exclude: ["DEBUG_*"],
        });

        expect(env.DEBUG_VAR).toBeUndefined();
        expect(env.NORMAL_VAR).toBe("normal");

        delete process.env.DEBUG_VAR;
        delete process.env.NORMAL_VAR;
      });

      it("should restore include patterns after exclude", () => {
        process.env.VITE_KEEP = "keep-me";

        const env = buildEnv({
          mode: "inherit",
          include: ["VITE_KEEP"], // 恢复被默认排除的变量
        });

        expect(env.VITE_KEEP).toBe("keep-me");

        delete process.env.VITE_KEEP;
      });
    });

    describe("isolate mode", () => {
      it("should only include PATH by default", () => {
        process.env.RANDOM_VAR = "random";

        const env = buildEnv({ mode: "isolate" });

        expect(env.PATH || env.Path).toBeDefined();
        expect(env.RANDOM_VAR).toBeUndefined();

        delete process.env.RANDOM_VAR;
      });

      it("should include user-specified patterns", () => {
        process.env.MY_APP_VAR = "my-value";

        const env = buildEnv({
          mode: "isolate",
          include: ["MY_APP_*"],
        });

        expect(env.MY_APP_VAR).toBe("my-value");

        delete process.env.MY_APP_VAR;
      });
    });

    describe("custom variables", () => {
      it("should add custom variables", () => {
        const env = buildEnv({
          custom: { NEW_VAR: "new-value" },
        });

        expect(env.NEW_VAR).toBe("new-value");
      });

      it("should override existing variables with custom", () => {
        process.env.OVERRIDE_ME = "original";

        const env = buildEnv({
          mode: "inherit",
          custom: { OVERRIDE_ME: "overridden" },
        });

        expect(env.OVERRIDE_ME).toBe("overridden");

        delete process.env.OVERRIDE_ME;
      });
    });

    describe("default behavior (no config)", () => {
      it("should use inherit mode with default excludes", () => {
        process.env.VITE_DEFAULT = "excluded";
        process.env.NORMAL_DEFAULT = "kept";

        const env = buildEnv(); // 无配置

        expect(env.VITE_DEFAULT).toBeUndefined();
        expect(env.NORMAL_DEFAULT).toBe("kept");

        delete process.env.VITE_DEFAULT;
        delete process.env.NORMAL_DEFAULT;
      });
    });
  });
});
