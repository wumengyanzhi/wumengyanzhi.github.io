import type { CardDefinitionConfig } from '@config/schemas/card.schema';
import type { EffectConfig } from '@config/schemas/effect.schema';
import { asDefinitionId, type DefinitionId } from './ids';
import type {
  CardType,
  Faction,
  Profession,
  Rarity,
  TacticDirection,
  WeaponClass,
} from './enums';

/**
 * 卡牌定义：跨局不变的内容。
 *
 * 同名卡牌共享一个定义；领域系统只读不写，实例化的强化与状态写在 CardInstance 上。
 */

interface CardDefinitionBase {
  readonly id: DefinitionId;
  readonly name: string;
  readonly cardType: CardType;
  readonly rarity: Rarity;
  readonly effects: readonly EffectConfig[];
}

export interface CharacterDefinition extends CardDefinitionBase {
  readonly cardType: 'character';
  readonly faction: Faction;
  readonly profession: Profession;
  readonly basePower: number;
}

export interface WeaponDefinition extends CardDefinitionBase {
  readonly cardType: 'weapon';
  readonly weaponClass: WeaponClass;
  readonly basePower: number;
  readonly baseAmp: number;
}

export interface TacticDefinition extends CardDefinitionBase {
  readonly cardType: 'tactic';
  readonly tacticDirection: TacticDirection;
  readonly basePower: number;
  readonly baseAmp: number;
}

export type CardDefinition = CharacterDefinition | WeaponDefinition | TacticDefinition;

export function createCardDefinition(config: CardDefinitionConfig): CardDefinition {
  const effects: readonly EffectConfig[] = config.effects.map((effect) =>
    Object.freeze({ ...effect, condition: Object.freeze({ ...effect.condition }) }),
  );
  const definition = { ...config, id: asDefinitionId(config.id), effects } as CardDefinition;
  return Object.freeze(definition);
}

export function isCharacterDefinition(definition: CardDefinition): definition is CharacterDefinition {
  return definition.cardType === 'character';
}

export function isWeaponDefinition(definition: CardDefinition): definition is WeaponDefinition {
  return definition.cardType === 'weapon';
}

export function isTacticDefinition(definition: CardDefinition): definition is TacticDefinition {
  return definition.cardType === 'tactic';
}
