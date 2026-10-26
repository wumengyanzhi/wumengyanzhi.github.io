import type { InstanceId } from '../models/ids';
import type { PlaySlot } from '../models/zone';

/**
 * 牌区状态。
 *
 * 抽牌堆顺序不可见，但状态本身有序；出牌框固定为配置给出的格数，空位用 null 表示。
 */
export interface ZonesState {
  readonly drawPile: readonly InstanceId[];
  readonly hand: readonly InstanceId[];
  readonly playSlots: readonly PlaySlot[];
  readonly discardPile: readonly InstanceId[];
  /** 本场消耗区：MVP 不使用，事件卡后续接入时启用。 */
  readonly consumed: readonly InstanceId[];
  /** 本局移除区：被吞噬或明确移除的卡，本局不参与洗牌与抽取。 */
  readonly removed: readonly InstanceId[];
}

export function createZonesState(playSlotCount: number): ZonesState {
  return {
    drawPile: [],
    hand: [],
    playSlots: Array.from({ length: playSlotCount }, () => null),
    discardPile: [],
    consumed: [],
    removed: [],
  };
}

export function withZones(base: ZonesState, patch: Partial<ZonesState>): ZonesState {
  return { ...base, ...patch };
}

export function clearPlaySlots(zones: ZonesState): ZonesState {
  return { ...zones, playSlots: zones.playSlots.map(() => null) };
}
