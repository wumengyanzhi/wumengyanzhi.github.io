import type { CardInstance } from '../models/card-instance';
import type { InstanceId } from '../models/ids';
import type { RngState } from '../ports/rng-port';
import type { BattleState } from './battle-state';
import type { GameState, HistoryEntry } from './game-state';
import type { RunState } from './run-state';
import type { ZonesState } from './zones-state';

/**
 * 不可变更新辅助。
 *
 * 所有更新都返回新对象，原状态保持不变，便于实现全有或全无的状态提交。
 */

export function replaceCard(state: GameState, instance: CardInstance): GameState {
  return { ...state, cards: { ...state.cards, [instance.instanceId]: instance } };
}

export function replaceCards(state: GameState, instances: readonly CardInstance[]): GameState {
  if (instances.length === 0) {
    return state;
  }
  const cards = { ...state.cards };
  for (const instance of instances) {
    cards[instance.instanceId] = instance;
  }
  return { ...state, cards };
}

export function withZones(state: GameState, zones: ZonesState): GameState {
  return { ...state, zones };
}

export function withBattle(state: GameState, battle: BattleState | null): GameState {
  return { ...state, battle };
}

export function withRun(state: GameState, run: RunState): GameState {
  return { ...state, run };
}

export function withRng(state: GameState, rng: RngState): GameState {
  return { ...state, rng };
}

export function withHistory(state: GameState, entry: HistoryEntry): GameState {
  return { ...state, history: [...state.history, entry] };
}

export function replaceAt<T>(list: readonly T[], index: number, value: T): readonly T[] {
  const next = [...list];
  next[index] = value;
  return next;
}

export function withoutInstanceId(list: readonly InstanceId[], instanceId: InstanceId): readonly InstanceId[] {
  return list.filter((entry) => entry !== instanceId);
}
