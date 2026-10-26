import type { InstanceId } from './ids';

/**
 * 牌区。
 *
 * MVP 不使用本场消耗区，但保留结构位，避免后续加入事件卡时改动牌区协议。
 */

export type PlaySlot = InstanceId | null;

export interface ZoneRef {
  readonly zone: 'playSlot';
  readonly slotIndex: number;
}

export interface HandRef {
  readonly zone: 'hand';
}

export type CardLocation = ZoneRef | HandRef | { readonly zone: 'drawPile' | 'discardPile' | 'consumed' | 'removed' };
