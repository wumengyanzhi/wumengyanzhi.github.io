import type { MoraleTier, BattleStatus } from '../models/enums';
import type { DefinitionId } from '../models/ids';

/**
 * 战斗状态。
 *
 * MVP 敌人只进行生命竞速：没有行动、没有阶段、没有状态。
 */
export interface BattleState {
  readonly enemyDefinitionId: DefinitionId;
  readonly enemyMaxHp: number;
  readonly enemyCurrentHp: number;
  /** 剩余主动出战次数，归零且敌人仍存活即失败。 */
  readonly playCountRemaining: number;
  /** 剩余主动弃牌次数。 */
  readonly discardCountRemaining: number;
  /** 本场军势档位，按战斗牌组中的人物数量锁定。 */
  readonly moraleTier: MoraleTier;
  /** 本场已累积的军势总点数。 */
  readonly moraleTotal: number;
  /** 本场是否发生过主动弃牌，供「已主动弃牌」类条件读取。 */
  readonly hasDiscardedThisBattle: boolean;
  readonly status: BattleStatus;
  /** 本场已经完成的出战次数，用于调试与重放比对。 */
  readonly completedPlays: number;
}

export const EMPTY_BATTLE: BattleState | null = null;

export function withBattle(base: BattleState, patch: Partial<BattleState>): BattleState {
  return { ...base, ...patch };
}
