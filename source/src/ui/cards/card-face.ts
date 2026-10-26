import type { CardDefinition } from '@domain/models/card-definition';
import type { CardInstance } from '@domain/models/card-instance';
import type { DefinitionId, InstanceId } from '@domain/models/ids';
import type { CardType, EnhancementTier, Faction, Profession, Rarity, TacticDirection, WeaponClass } from '@domain/models/enums';

/**
 * 卡面显示数据。
 *
 * 界面需要的信息分散在 CardDefinition 与 CardInstance 两处，这里只做一次合并，
 * 不做任何数值计算——四层数值原样带出来，由组件决定显示哪一层。
 */

export interface CardFace {
  readonly instanceId: InstanceId;
  readonly definitionId: DefinitionId;
  readonly name: string;
  readonly cardType: CardType;
  readonly rarity: Rarity;
  readonly power: number;
  readonly amp: number;
  readonly basePower: number;
  readonly baseAmp: number;
  readonly morale: number;
  readonly permanentPower: number;
  readonly permanentAmp: number;
  readonly battleTemporaryPower: number;
  readonly battleTemporaryAmp: number;
  readonly thisPlayPower: number;
  readonly thisPlayAmp: number;
  readonly enhancementSkillIds: readonly string[];
  readonly faction: Faction | null;
  readonly profession: Profession | null;
  readonly weaponClass: WeaponClass | null;
  readonly tacticDirection: TacticDirection | null;
}

export const RARITY_TEXT: Readonly<Record<Rarity, string>> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

export const CARD_TYPE_TEXT: Readonly<Record<CardType, string>> = {
  character: '人物',
  weapon: '武器',
  tactic: '战术',
  event: '事件',
};

export const PROFESSION_TEXT: Readonly<Record<Profession, string>> = {
  warrior: '武者',
  archer: '弓手',
  strategist: '谋士',
  assassin: '暗客',
  guard: '卫士',
};

export const WEAPON_CLASS_TEXT: Readonly<Record<WeaponClass, string>> = {
  blade: '刀',
  spear: '枪',
  bow: '弓',
  implement: '法器',
  hidden: '暗器',
};

export const FACTION_TEXT: Readonly<Record<Faction, string>> = {
  shu: '蜀',
  wei: '魏',
  wu: '吴',
  qun: '群',
};

export const RELATION_TEXT = {
  main: '本职',
  usable: '可用',
  off: '偏门',
  none: '不匹配',
} as const;

export const RELATION_ORDER = ['main', 'usable', 'off'] as const;

export const ENHANCEMENT_TIER_TEXT: Readonly<Record<EnhancementTier, string>> = {
  common: '普通强化',
  rare: '稀有强化',
  legendary: '传说强化',
};

export const CARD_HUES: readonly number[] = [22, 38, 58, 82, 108, 142, 168, 196, 222, 248, 276, 318];

/** 由定义 ID 派生稳定色相：同一张卡在任何页面都是同一个颜色。 */
export function cardHue(definitionId: string): number {
  let hash = 0;
  for (let index = 0; index < definitionId.length; index += 1) {
    hash = (hash * 31 + definitionId.charCodeAt(index)) % 100000;
  }
  return CARD_HUES[hash % CARD_HUES.length] ?? 60;
}

export function buildCardFace(
  instance: CardInstance | undefined,
  definition: CardDefinition | undefined,
): CardFace | null {
  if (instance === undefined || definition === undefined) return null;
  const baseAmp = definition.cardType === 'character' ? 0 : definition.baseAmp;
  return {
    instanceId: instance.instanceId,
    definitionId: definition.id,
    name: definition.name,
    cardType: definition.cardType,
    rarity: definition.rarity,
    // selectors 已经给出四层之和，这里按同一口径重算一遍，避免界面与选择器漂移。
    power: definition.basePower + instance.thisPlayPower + instance.battleTemporaryPower + instance.permanentPower,
    amp: baseAmp + instance.thisPlayAmp + instance.battleTemporaryAmp + instance.permanentAmp,
    basePower: definition.basePower,
    baseAmp,
    morale: instance.morale,
    permanentPower: instance.permanentPower,
    permanentAmp: instance.permanentAmp,
    battleTemporaryPower: instance.battleTemporaryPower,
    battleTemporaryAmp: instance.battleTemporaryAmp,
    thisPlayPower: instance.thisPlayPower,
    thisPlayAmp: instance.thisPlayAmp,
    enhancementSkillIds: instance.enhancementSkillIds,
    faction: definition.cardType === 'character' ? definition.faction : null,
    profession: definition.cardType === 'character' ? definition.profession : null,
    weaponClass: definition.cardType === 'weapon' ? definition.weaponClass : null,
    tacticDirection: definition.cardType === 'tactic' ? definition.tacticDirection : null,
  };
}
