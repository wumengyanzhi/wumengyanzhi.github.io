import { z } from 'zod';
import { CARD_TYPES, FACTIONS, PROFESSIONS, RARITIES, TACTIC_DIRECTIONS, WEAPON_CLASSES } from '@domain/models/enums';
import { EffectConfigSchema } from './effect.schema';

/**
 * 卡牌定义配置。
 *
 * 事件卡只保留类型位，MVP 不加载任何事件定义或事件效果。
 */

const CommonIdentitySchema = {
  id: z.string().min(1),
  name: z.string().min(1),
  rarity: z.enum(RARITIES),
  effects: z.array(EffectConfigSchema).default([]),
};

const CharacterCardSchema = z.object({
  ...CommonIdentitySchema,
  cardType: z.literal('character'),
  faction: z.enum(FACTIONS),
  profession: z.enum(PROFESSIONS),
  basePower: z.number().int().nonnegative(),
});

const WeaponCardSchema = z.object({
  ...CommonIdentitySchema,
  cardType: z.literal('weapon'),
  weaponClass: z.enum(WEAPON_CLASSES),
  basePower: z.number().int().nonnegative(),
  baseAmp: z.number().int().nonnegative(),
});

const TacticCardSchema = z.object({
  ...CommonIdentitySchema,
  cardType: z.literal('tactic'),
  tacticDirection: z.enum(TACTIC_DIRECTIONS),
  basePower: z.number().int().nonnegative(),
  baseAmp: z.number().int().nonnegative(),
});

export const CardDefinitionSchema = z.discriminatedUnion('cardType', [
  CharacterCardSchema,
  WeaponCardSchema,
  TacticCardSchema,
]);

export type CardDefinitionConfig = z.infer<typeof CardDefinitionSchema>;
export type CharacterCardConfig = z.infer<typeof CharacterCardSchema>;
export type WeaponCardConfig = z.infer<typeof WeaponCardSchema>;
export type TacticCardConfig = z.infer<typeof TacticCardSchema>;

export const CARD_TYPE_VALUES = CARD_TYPES;
