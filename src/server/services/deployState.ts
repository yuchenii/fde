/**
 * 部署状态管理器
 * 管理每个环境的部署状态、输出缓冲和最终结果
 */

export interface OutputEntry {
  id: number;
  event: "output" | "done" | "error";
  data: unknown;
}

interface DeployResult {
  success: boolean;
  startTime: Date;
  endTime: Date;
  exitCode: number;
}

export interface DeployRun {
  deploymentId: string;
  startTime: Date;
  firstEventId: number;
  outputBuffer: OutputEntry[];
  nextId: number;
  lastResult?: DeployResult;
  listeners: Set<(entry: OutputEntry) => void>;
}

const deployStates = new Map<string, { latest: DeployRun; stream?: DeployRun }>();

export function getStreamDeploy(env: string): DeployRun | undefined {
  return deployStates.get(env)?.stream;
}

export function startDeploy(env: string, streaming = false): DeployRun {
  const previousStream = getStreamDeploy(env);
  const firstEventId = previousStream?.nextId ?? 1;
  const run: DeployRun = {
    deploymentId: crypto.randomUUID(),
    startTime: new Date(),
    firstEventId,
    nextId: firstEventId,
    outputBuffer: [],
    listeners: new Set(),
  };
  deployStates.set(env, { latest: run, stream: streaming ? run : previousStream });
  return run;
}

export function addOutput(
  run: DeployRun,
  event: OutputEntry["event"],
  data: unknown
): void {
  const entry = { id: run.nextId++, event, data };
  if (event === "output") run.outputBuffer.push(entry);
  for (const listener of run.listeners) listener(entry);
}

/**
 * 完成部署
 * 保存结果，清空缓冲区
 */
export function finishDeploy(
  run: DeployRun,
  result: Pick<DeployResult, "success" | "exitCode">
): void {
  run.lastResult = {
    success: result.success,
    exitCode: result.exitCode,
    startTime: run.startTime,
    endTime: new Date(),
  };
  run.outputBuffer.length = 0;
}

/**
 * 检查是否应该拒绝新部署
 * 防止反向代理/网络层重复请求导致的重复部署
 * 冷却期：部署完成后 cooldownMs 内不接受新的部署请求（0 表示关闭冷却）
 */
export function shouldRejectNewDeploy(
  env: string,
  cooldownMs = 30_000
): {
  reject: boolean;
  reason?: string;
} {
  const state = deployStates.get(env)?.latest;
  if (!state) return { reject: false };

  // 正在部署中
  if (!state.lastResult) {
    return { reject: true, reason: "Deployment already in progress" };
  }

  // 检查冷却期
  if (cooldownMs > 0) {
    const elapsed = Date.now() - state.lastResult.endTime.getTime();
    if (elapsed < cooldownMs) {
      return {
        reject: true,
        reason: `Deployment cooldown (${((cooldownMs - elapsed) / 1000).toFixed(
          1
        )}s remaining)`,
      };
    }
  }

  return { reject: false };
}

/**
 * 获取部署状态
 */
export function getDeployStatus(env: string, deploymentId: string | null = null) {
  const state = deployStates.get(env);
  const run = deploymentId === null || state?.latest.deploymentId === deploymentId
    ? state?.latest
    : state?.stream;
  if (deploymentId !== null && run?.deploymentId !== deploymentId) return null;
  return {
    deploymentId: run?.deploymentId,
    running: !!run && !run.lastResult,
    startTime: run?.startTime,
    bufferedCount: run?.outputBuffer.length ?? 0,
    lastResult: run?.lastResult ?? null,
  };
}

/**
 * 清除部署状态（测试用；传 env 则只清该环境，否则清空全部）
 */
export function resetDeployState(env?: string): void {
  if (env) {
    deployStates.delete(env);
    return;
  }
  deployStates.clear();
}
