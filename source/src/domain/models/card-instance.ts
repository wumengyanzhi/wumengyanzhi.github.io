import type { InstanceId, DefinitionId } from './ids';
import type { ZoneType } from './enums';

/**
 * 卡牌实例：单个实体在一局冒险中的全部变化。
 *
 * 同名卡牌的不同实例分别记录强化与状态，互不影响。
 */

export interface StatusStack {
  readonly statusId: string;
  readonly stacks: number;
  /** 剩余次数；无次数限制时为 null。 */
  readonly remainingUses: number | null;
}

export interface CardInstance {
  readonly instanceId: InstanceId;
  readonly definitionId: DefinitionId;

  /** 本局永久强化，写入具体实体，战斗结束后继续保留。 */
  readonly permanentPower: number;
  readonly permanentAmp: number;
  /** 本场临时加成，跟随实体穿过牌区，战斗结束清除。 */
  readonly battleTemporaryPower: number;
  readonly battleTemporaryAmp: number;
  /** 本次出战加成，本次结算后清除。 */
  readonly thisPlayPower: number;
  readonly thisPlayAmp: number;

  /** 军势：本场累积，战斗结束清零；重复主动打出同一人物可再次获得。 */
  readonly morale: number;
  /** 战后强化附加的局内技能 ID。 */
  readonly enhancementSkillIds: readonly string[];
  /** 本场已经用过的附加技能，用于「每场战斗限一次」。 */
  readonly usedEnhancementSkillIdsThisBattle: readonly string[];
  readonly statuses: readonly StatusStack[];

  readonly zone: ZoneType;
  /** 出牌框中的索引；不在出牌框时为 null。 */
  readonly slotIndex: number | null;
  /** 武器本次装备给的人物实例；非武器或未装备时为 null。 */
  readonly equippedToInstanceId: InstanceId | null;
}

export function createCardInstance(instanceId: InstanceId, definitionId: DefinitionId): CardInstance {
  return {
    instanceId,
    definitionId,
    permanentPower: 0,
    permanentAmp: 0,
    battleTemporaryPower: 0,
    battleTemporaryAmp: 0,
    thisPlayPower: 0,
    thisPlayAmp: 0,
    morale: 0,
    enhancementSkillIds: [],
    usedEnhancementSkillIdsThisBattle: [],
    statuses: [],
    zone: 'drawPile',
    slotIndex: null,
    equippedToInstanceId: null,
  };
}

export function effectivePower(instance: CardInstance): number {
  return instance.thisPlayPower + instance.battleTemporaryPower + instance.permanentPower;
}

export function effectiveAmp(instance: CardInstance): number {
  return instance.thisPlayAmp + instance.battleTemporaryAmp + instance.permanentAmp;
}

export function withZone(instance: CardInstance, zone: ZoneType, slotIndex: number | null = null): CardInstance {
  return { ...instance, zone, slotIndex };
}

export function withEquippedTo(instance: CardInstance, targetInstanceId: InstanceId | null): CardInstance {
  return { ...instance, equippedToInstanceId: targetInstanceId };
}

export function addPermanentStats(instance: CardInstance, power: number, amp: number): CardInstance {
  return { ...instance, permanentPower: instance.permanentPower + power, permanentAmp: instance.permanentAmp + amp };
}

export function addBattleTemporaryStats(instance: CardInstance, power: number, amp: number): CardInstance {
  return {
    ...instance,
    battleTemporaryPower: instance.battleTemporaryPower + power,
    battleTemporaryAmp: instance.battleTemporaryAmp + amp,
  };
}

export function addThisPlayStats(instance: CardInstance, power: number, amp: number): CardInstance {
  return {
    ...instance,
    thisPlayPower: instance.thisPlayPower + power,
    thisPlayAmp: instance.thisPlayAmp + amp,
  };
}

export function clearThisPlayStats(instance: CardInstance): CardInstance {
  return { ...instance, thisPlayPower: 0, thisPlayAmp: 0 };
}

export function gainMorale(instance: CardInstance, amount: number): CardInstance {
  return { ...instance, morale: instance.morale + amount };
}

export function addEnhancementSkill(instance: CardInstance, skillId: string): CardInstance {
  if (instance.enhancementSkillIds.includes(skillId)) {
    return instance;
  }
  return { ...instance, enhancementSkillIds: [...instance.enhancementSkillIds, skillId] };
}

export function markEnhancementSkillUsed(instance: CardInstance, skillId: string): CardInstance {
  if (instance.usedEnhancementSkillIdsThisBattle.includes(skillId)) {
    return instance;
  }
  return {
    ...instance,
    usedEnhancementSkillIdsThisBattle: [...instance.usedEnhancementSkillIdsThisBattle, skillId],
  };
}

/** 战斗结束：清除本场临时加成、军势、装备关系与技能使用记录。 */
export function clearBattleState(instance: CardInstance): CardInstance {
  return {
    ...instance,
    battleTemporaryPower: 0,
    battleTemporaryAmp: 0,
    thisPlayPower: 0,
    thisPlayAmp: 0,
    morale: 0,
    slotIndex: null,
    equippedToInstanceId: null,
    usedEnhancementSkillIdsThisBattle: [],
    statuses: [],
  };
}
