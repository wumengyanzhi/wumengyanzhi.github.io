import { z } from 'zod';
import { ENHANCEMENT_TIERS, MATCH_RELATIONS, PROFESSIONS, WEAPON_CLASSES } from '@domain/models/enums';

/**
 * 平衡配置。
 *
 * 所有可平衡数值都在这里；领域代码不得散落可平衡数字字面量。
 */

export const DamageBalanceSchema = z.object({
  /** 每次出战时威力区的起始值。 */
  basePower: z.number().int().nonnegative(),
  /** 每次出战时增幅区的起始值，现行规则固定为 1。 */
  baseAmp: z.number().int().nonnegative(),
});

export const MoraleBalanceSchema = z.object({
  /** 人物数量在 0～10 时为未成军，不启用军势。 */
  noneMaxCharacterCount: z.number().int().nonnegative(),
  /** 人物数量在 11～15 时为成军。 */
  formedMaxCharacterCount: z.number().int().positive(),
  /** 成军与列阵下，每点军势提供的威力。 */
  powerPerPoint: z.number().int().nonnegative(),
  /** 列阵下，每多少点军势额外提供 1 点增幅。 */
  ampPerPoints: z.number().int().positive(),
});

export const BattleBalanceSchema = z.object({
  handLimit: z.number().int().positive(),
  playCount: z.number().int().positive(),
  discardCount: z.number().int().nonnegative(),
  playSlotCount: z.number().int().positive(),
  /** 一次主动弃牌最多选择的张数。 */
  maxDiscardSelection: z.number().int().positive(),
});

export const MatchMatrixSchema = z.object({
  /** 各匹配层级额外进入增幅区的数值：本职 +4、可用 +2、偏门 +1、不匹配 +0。 */
  relationAmp: z.record(z.enum(MATCH_RELATIONS), z.number().int().nonnegative()),
  /** 职业 × 武器分类的关系表。 */
  matrix: z.record(z.enum(PROFESSIONS), z.record(z.enum(WEAPON_CLASSES), z.enum(MATCH_RELATIONS))),
});

export const EconomyBalanceSchema = z.object({
  initialGold: z.number().int().nonnegative(),
  /** 第一、第二场胜利后，在生成强化候选前获得的金币。 */
  victoryGold: z.number().int().nonnegative(),
  rerollCost: z.number().int().nonnegative(),
  maxRerollsPerStage: z.number().int().nonnegative(),
});

export const EnhancementBalanceSchema = z.object({
  candidateCount: z.number().int().positive(),
  /** 每个奖励阶段的档位概率，键为奖励阶段标识，值为三档权重。 */
  stageWeights: z.record(z.string().min(1), z.record(z.enum(ENHANCEMENT_TIERS), z.number().int().nonnegative())),
  /** 各档位提供的数值；武器等概率在威力与增幅之间选择。 */
  tierValues: z.record(z.enum(ENHANCEMENT_TIERS), z.object({
    power: z.number().int().nonnegative(),
    amp: z.number().int().nonnegative(),
  })),
  /** 允许生成强化的属性：人物只有威力，威力型战术只有威力，增幅型战术只有增幅。 */
  allowedAttributes: z.object({
    character: z.array(z.enum(['power', 'amp'])),
    weapon: z.array(z.enum(['power', 'amp'])),
    tactic_power: z.array(z.enum(['power', 'amp'])),
    tactic_amp: z.array(z.enum(['power', 'amp'])),
  }),
  /** 传说档可附加的局内技能池。 */
  legendarySkillPool: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    text: z.string().min(1),
    effect: z.object({
      kind: z.enum([
        'first_play_power',
        'first_play_amp',
        'same_type_power',
        'unique_type_amp',
        'once_after_resolve_gold',
        'repeat_original',
      ]),
      value: z.number().int().positive(),
    }),
  })),
});

export type DamageBalance = z.infer<typeof DamageBalanceSchema>;
export type MoraleBalance = z.infer<typeof MoraleBalanceSchema>;
export type BattleBalance = z.infer<typeof BattleBalanceSchema>;
export type MatchMatrix = z.infer<typeof MatchMatrixSchema>;
export type EconomyBalance = z.infer<typeof EconomyBalanceSchema>;
export type EnhancementBalance = z.infer<typeof EnhancementBalanceSchema>;
