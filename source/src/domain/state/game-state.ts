import type { CardInstance } from '../models/card-instance';
import type { InstanceId } from '../models/ids';
import type { EnhancementTier } from '../models/enums';
import type { RngState } from '../ports/rng-port';
import type { BattleState } from './battle-state';
import type { RunState } from './run-state';
import type { ZonesState } from './zones-state';

/**
 * 游戏状态。
 *
 * 领域操作接收旧状态与命令，返回新状态与事件；React 组件不得直接修改这里的内部对象。
 */

/** 程序版本：发布新的可运行构建时提升。 */
export const APP_VERSION = '0.1.0-mvp.1';
/** 存档数据结构版本：字段或语义不兼容变化时提升。 */
export const SAVE_VERSION = 2;

export interface GameStateMeta {
  readonly appVersion: string;
  readonly contentVersion: string;
  readonly saveVersion: number;
}

export interface EnhancementCandidate {
  readonly id: string;
  readonly targetInstanceId: InstanceId;
  readonly tier: EnhancementTier;
  readonly attribute: 'power' | 'amp';
  readonly amount: number;
  readonly skillId: string | null;
}

export type PendingChoice = {
  readonly kind: 'weapon_target';
  readonly weaponInstanceId: InstanceId;
  readonly candidateInstanceIds: readonly InstanceId[];
} | {
  readonly kind: 'enhancement_reward';
  readonly stageId: string;
  readonly candidates: readonly EnhancementCandidate[];
} | null;

export interface HistoryEntry {
  readonly kind: 'command' | 'event';
  readonly type: string;
  readonly payload: Readonly<Record<string, string | number>>;
}

/** 卡牌实例按实例 ID 索引，键为普通字符串以便序列化。 */
export type CardInstanceMap = Readonly<Record<string, CardInstance>>;

export interface GameState {
  readonly meta: GameStateMeta;
  readonly run: RunState;
  readonly battle: BattleState | null;
  readonly zones: ZonesState;
  readonly cards: CardInstanceMap;
  readonly pendingChoice: PendingChoice;
  readonly equipmentTargets: Readonly<Record<string, InstanceId>>;
  readonly rng: RngState;
  readonly history: readonly HistoryEntry[];
}

export interface CreateGameStateInput {
  readonly contentVersion: string;
  readonly run: RunState;
  readonly zones: ZonesState;
  readonly cards: CardInstanceMap;
  readonly rng: RngState;
  readonly battle?: BattleState | null;
}

export function createGameState(input: CreateGameStateInput): GameState {
  return Object.freeze({
    meta: {
      appVersion: APP_VERSION,
      contentVersion: input.contentVersion,
      saveVersion: SAVE_VERSION,
    },
    run: input.run,
    battle: input.battle ?? null,
    zones: input.zones,
    cards: input.cards,
    pendingChoice: null,
    equipmentTargets: {},
    rng: input.rng,
    history: [],
  } satisfies GameState);
}

export function getCardInstance(state: GameState, instanceId: InstanceId): CardInstance | undefined {
  return state.cards[instanceId];
}
