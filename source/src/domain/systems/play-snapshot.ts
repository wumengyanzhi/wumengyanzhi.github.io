import type { InstanceId } from '../models/ids';
import type { PlaySlot } from '../models/zone';
import type { CardInstanceMap } from '../state/game-state';
import type { BattleState } from '../state/battle-state';

/**
 * 出战快照。
 *
 * 点击出战即冻结位置、空位、相邻关系与剩余手牌；
 * 结算期间即使有卡牌离场，也不重新连接被隔开的卡牌。
 */
export interface PlaySnapshot {
  readonly slots: readonly PlaySlot[];
  /** 从左到右的参与实体，空位不参与。 */
  readonly participantIds: readonly InstanceId[];
  readonly handAfter: readonly InstanceId[];
  readonly cards: CardInstanceMap;
  readonly battle: BattleState;
  readonly equipmentTargets: Readonly<Record<string, InstanceId>>;
}

export interface PlaySlotAssignment {
  readonly slotIndex: number;
  readonly instanceId: InstanceId;
}

export function buildPlaySnapshot(
  slots: readonly PlaySlot[],
  handAfter: readonly InstanceId[],
  cards: CardInstanceMap,
  battle: BattleState,
  equipmentTargets: Readonly<Record<string, InstanceId>>,
): PlaySnapshot {
  const participantIds: InstanceId[] = [];
  for (const slot of slots) {
    if (slot !== null && slot !== undefined) {
      participantIds.push(slot);
    }
  }
  const frozenCards: Record<string, CardInstanceMap[string]> = {};
  for (const instanceId of participantIds) {
    const instance = cards[instanceId];
    if (instance !== undefined) {
      frozenCards[instanceId] = {
        ...instance,
        enhancementSkillIds: [...instance.enhancementSkillIds],
        usedEnhancementSkillIdsThisBattle: [...instance.usedEnhancementSkillIdsThisBattle],
        statuses: instance.statuses.map((status) => ({ ...status })),
      };
    }
  }
  return {
    slots: [...slots],
    participantIds,
    handAfter: [...handAfter],
    cards: frozenCards,
    battle: { ...battle },
    equipmentTargets: { ...equipmentTargets },
  };
}

export function neighbourOccupied(slots: readonly PlaySlot[], index: number): boolean {
  const slot = slots[index];
  return slot !== null && slot !== undefined;
}
