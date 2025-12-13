/**
 * 部署状态管理器
 * 管理每个环境的部署状态、输出缓冲和最终结果
 */

interface OutputEntry {
  id: number;
  event: string;
  data: any;
}

interface DeployResult {
  success: boolean;
  startTime: Date;
  endTime: Date;
  exitCode: number;
  message?: string;
}

interface DeployState {
  running: boolean;
  startTime?: Date;
  outputBuffer: OutputEntry[];
  nextId: number;
  lastResult?: DeployResult;
}

// 每个环境的部署状态
const deployStates = new Map<string, DeployState>();

/**
 * 获取或创建环境的部署状态
 */
function getState(env: string): DeployState {
  if (!deployStates.has(env)) {
    deployStates.set(env, {
      running: false,
      outputBuffer: [],
      nextId: 1,
    });
  }
  return deployStates.get(env)!;
}

/**
 * 开始新的部署
 * 清空上次结果，重置缓冲区
 */
export function startDeploy(env: string): void {
  const state = getState(env);
  state.running = true;
  state.startTime = new Date();
  state.outputBuffer = [];
  state.nextId = 1;
  state.lastResult = undefined; // 清空上次结果
}

/**
 * 添加输出到缓冲区
 * @returns 输出的序号 ID
 */
export function addOutput(env: string, event: string, data: any): number {
  const state = getState(env);
  const id = state.nextId++;
  state.outputBuffer.push({ id, event, data });
  return id;
}

/**
 * 完成部署
 * 保存结果，清空缓冲区
 */
export function finishDeploy(
  env: string,
  result: Omit<DeployResult, "startTime" | "endTime"> & { endTime?: Date }
): void {
  const state = getState(env);
  state.running = false;
  state.lastResult = {
    ...result,
    startTime: state.startTime || new Date(),
    endTime: result.endTime || new Date(),
  };
  state.outputBuffer = []; // 清空缓冲区
}

/**
 * 获取从指定 ID 开始的输出
 * @param fromId 起始 ID（不包含），0 表示获取所有
 * @returns 输出列表
 */
export function getOutputsFrom(env: string, fromId: number): OutputEntry[] {
  const state = getState(env);
  if (fromId === 0) {
    return [...state.outputBuffer];
  }
  return state.outputBuffer.filter((entry) => entry.id > fromId);
}

/**
 * 检查部署是否正在运行
 */
export function isDeploying(env: string): boolean {
  const state = getState(env);
  return state.running;
}

/**
 * 检查是否应该拒绝新部署
 * 防止反向代理/网络层重复请求导致的重复部署
 * 冷却期：部署完成后 5 秒内不接受新的部署请求
 */
export function shouldRejectNewDeploy(env: string): {
  reject: boolean;
  reason?: string;
} {
  const state = getState(env);

  // 正在部署中
  if (state.running) {
    return { reject: true, reason: "Deployment already in progress" };
  }

  // 检查冷却期（5秒）
  if (state.lastResult) {
    const cooldownMs = 5000;
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
export function getDeployStatus(env: string): {
  running: boolean;
  startTime?: Date;
  bufferedCount: number;
  lastResult?: DeployResult;
} {
  const state = getState(env);
  return {
    running: state.running,
    startTime: state.startTime,
    bufferedCount: state.outputBuffer.length,
    lastResult: state.lastResult,
  };
}

/**
 * 获取当前输出缓冲区的最新 ID
 */
export function getLatestOutputId(env: string): number {
  const state = getState(env);
  return state.nextId - 1;
}
