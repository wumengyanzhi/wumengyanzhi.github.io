import type { RunNodeId } from '../models/ids';

/**
 * 本局冒险状态。
 *
 * MVP 为线性三战；流程顺序来自 RunDefinition，这里只记录当前节点与资源。
 */
export interface RunState {
  readonly runDefinitionId: string;
  readonly currentNodeId: RunNodeId | null;
  readonly gold: number;
  readonly battlesWon: number;
  readonly status: 'running' | 'won' | 'lost';
  /** 当前奖励阶段已经刷新过的次数。 */
  readonly rerollsUsed: number;
}

export function createRunState(runDefinitionId: string, startNodeId: RunNodeId, gold: number): RunState {
  return {
    runDefinitionId,
    currentNodeId: startNodeId,
    gold,
    battlesWon: 0,
    status: 'running',
    rerollsUsed: 0,
  };
}

export function withRun(base: RunState, patch: Partial<RunState>): RunState {
  return { ...base, ...patch };
}
