/**
 * 环境变量配置接口
 */
export interface EnvConfig {
  /** 模式：inherit（继承并过滤）| isolate（隔离并添加） */
  mode?: "inherit" | "isolate";

  /** 包含的变量（精确名称或 * 通配符，如 VITE_*） */
  include?: string[];

  /** 排除的变量（精确名称或 * 通配符，如 VITE_*） */
  exclude?: string[];

  /** 自定义变量（覆盖或新增） */
  custom?: Record<string, string>;
}

/** inherit 模式下内置的 exclude 规则 */
const DEFAULT_INHERIT_EXCLUDE = [
  "NODE_ENV",
  "VITE_*",
  "REACT_APP_*",
  "NEXT_PUBLIC_*",
  "NUXT_*",
  "VUE_APP_*",
];

/** isolate 模式下内置的必要变量 */
const DEFAULT_ISOLATE_INCLUDE = [
  // 通用
  "PATH",
  "Path",  // Windows 兼容
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_*",
  "TERM",
  "TMPDIR",
  // macOS/Linux
  "SSH_AUTH_SOCK",
  "DISPLAY",
  "XDG_*",
  // Windows
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "COMSPEC",
  "SYSTEMROOT",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
];

/**
 * 匹配模式：
 * - /regex/ → 直接使用正则表达式
 * - glob 模式 → * 转换为 .* 后作为正则匹配
 */
function matchesPattern(varName: string, pattern: string): boolean {
  // 正则模式：/pattern/ 或 /pattern/flags
  const regexMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[1], regexMatch[2]).test(varName);
    } catch (e) {
      console.warn(`⚠️ Invalid regex pattern: ${pattern}`, e);
      return false;
    }
  }

  // Glob 模式：* 转换为 .*，其他字符转义
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = `^${escaped.replace(/\*/g, ".*")}$`;
  return new RegExp(regexStr).test(varName);
}

/**
 * 检查变量名是否匹配任一模式
 */
function matchesAnyPattern(varName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(varName, pattern));
}

/**
 * 合并两层 EnvConfig（顶层 + 环境级）
 */
export function mergeEnvConfig(
  topLevel?: EnvConfig,
  envLevel?: EnvConfig
): EnvConfig {
  return {
    mode: envLevel?.mode ?? topLevel?.mode ?? "inherit",
    exclude: [...(topLevel?.exclude ?? []), ...(envLevel?.exclude ?? [])],
    include: [...(topLevel?.include ?? []), ...(envLevel?.include ?? [])],
    custom: { ...(topLevel?.custom ?? {}), ...(envLevel?.custom ?? {}) },
  };
}

/**
 * 根据配置构建子进程环境变量
 */
export function buildEnv(
  config?: EnvConfig
): Record<string, string | undefined> {
  const mode = config?.mode ?? "inherit";
  const userExclude = config?.exclude ?? [];
  const userInclude = config?.include ?? [];
  const custom = config?.custom ?? {};

  let env: Record<string, string | undefined> = {};

  if (mode === "inherit") {
    // 继承模式：从 process.env 开始，删除匹配 exclude 的变量
    env = { ...process.env };

    // 合并内置 exclude 和用户 exclude
    const allExclude = [...DEFAULT_INHERIT_EXCLUDE, ...userExclude];

    for (const key of Object.keys(env)) {
      if (matchesAnyPattern(key, allExclude)) {
        delete env[key];
      }
    }

    // 恢复 include 中指定的变量（从原始 process.env）
    for (const key of Object.keys(process.env)) {
      if (matchesAnyPattern(key, userInclude)) {
        env[key] = process.env[key];
      }
    }
  } else {
    // 隔离模式：从空开始，只添加内置必要变量 + 用户 include
    const allInclude = [...DEFAULT_ISOLATE_INCLUDE, ...userInclude];

    for (const key of Object.keys(process.env)) {
      if (matchesAnyPattern(key, allInclude)) {
        env[key] = process.env[key];
      }
    }
  }

  // 应用自定义变量（覆盖）
  for (const [key, value] of Object.entries(custom)) {
    env[key] = value;
  }

  return env;
}
