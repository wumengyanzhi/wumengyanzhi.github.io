import { z } from 'zod';
import {
  CARD_TYPES,
  EFFECT_TARGETS,
  EFFECT_TIMINGS,
  MATCH_RELATIONS,
  STAT_SCOPES,
} from '@domain/models/enums';

/**
 * 效果配置。
 *
 * 配置只声明时机、条件与操作，不包含任何可执行表达式。
 * 操作类型与领域 effect-registry 的处理器一一对应：未知类型在配置校验阶段被 zod 拒绝，
 * 不会留到运行期静默失效。新增卡牌优先组合已有条件与操作，只有出现全新机制才加处理器。
 */

const EffectConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('always') }),
  z.object({ type: z.literal('self_equipped_weapon_relation'), relation: z.enum(MATCH_RELATIONS) }),
  z.object({ type: z.literal('self_adjacent_both'), cardType: z.enum(CARD_TYPES) }),
  z.object({ type: z.literal('play_contains_card_type'), cardType: z.enum(CARD_TYPES), min: z.number().int().positive() }),
  z.object({ type: z.literal('play_contains_distinct_card_types'), min: z.number().int().positive() }),
  z.object({ type: z.literal('discarded_this_battle'), min: z.number().int().positive() }),
]);

const ScaleSchema = z.object({
  countCardType: z.enum(CARD_TYPES),
  each: z.number().int(),
  max: z.number().int(),
});

/** 可缩放的威力／增幅操作；target 为 zone 时作用于本次出战整体。 */
const AddStatOperationSchema = z.object({
  target: z.enum(EFFECT_TARGETS),
  scope: z.enum(STAT_SCOPES),
  value: z.number().int(),
  scale: ScaleSchema.optional(),
});

const GainGoldOperationSchema = z.object({
  type: z.literal('gain_gold'),
  value: z.number().int().positive(),
});

const ConsumeResourceOperationSchema = z.object({
  type: z.literal('consume_resource'),
  resource: z.literal('gold'),
  amount: z.number().int().positive(),
});

const DrawCardsOperationSchema = z.object({
  type: z.literal('draw_cards'),
  count: z.number().int().positive(),
});

const MoveCardOperationSchema = z.object({
  type: z.literal('move_card'),
  target: z.enum(EFFECT_TARGETS),
  to: z.enum(['drawPile', 'hand', 'discardPile', 'consumed', 'removed']),
});

/** 本场临时加成：写实体的本场临时层，战斗结束清除。 */
const AddTemporaryStatOperationSchema = z.object({
  type: z.literal('add_temporary_stat'),
  target: z.enum(EFFECT_TARGETS),
  power: z.number().int(),
  amp: z.number().int(),
});

/** 本局永久强化：写入具体实体，跨战斗保留；受来源稀有度权限约束。 */
const AddPermanentCardStatOperationSchema = z.object({
  type: z.literal('add_permanent_card_stat'),
  target: z.enum(EFFECT_TARGETS),
  power: z.number().int(),
  amp: z.number().int(),
});

const ApplyStatusOperationSchema = z.object({
  type: z.literal('apply_status'),
  target: z.enum(EFFECT_TARGETS),
  statusId: z.string().min(1),
  stacks: z.number().int().positive(),
  /** 无次数限制时为 null。 */
  remainingUses: z.number().int().positive().nullable(),
});

/** 重复同一张卡上的另一个效果；次数受上限约束，且不得指向自身。 */
const RepeatEffectOperationSchema = z.object({
  type: z.literal('repeat_effect'),
  effectId: z.string().min(1),
  times: z.number().int().positive(),
});

/** 查看抽牌堆顶若干张并保持相对顺序放回顶部或底部。 */
const InspectAndReorderDeckOperationSchema = z.object({
  type: z.literal('inspect_and_reorder_deck'),
  count: z.number().int().positive(),
  to: z.enum(['top', 'bottom']),
});

/**
 * 吸收另一张卡的数值。
 *
 * 只读目标的基础与本局永久两层，本场临时与本次加成不可被吸收，避免同一份加成被反复复制。
 */
const ChangeEffectiveValueOperationSchema = z.object({
  type: z.literal('change_effective_value'),
  mode: z.enum(['absorb_power', 'absorb_amp']),
  from: z.enum(EFFECT_TARGETS),
  scope: z.enum(STAT_SCOPES),
});

const EffectOperationSchema = z.discriminatedUnion('type', [
  AddStatOperationSchema.extend({ type: z.literal('add_power') }),
  AddStatOperationSchema.extend({ type: z.literal('add_amp') }),
  GainGoldOperationSchema,
  ConsumeResourceOperationSchema,
  DrawCardsOperationSchema,
  MoveCardOperationSchema,
  AddTemporaryStatOperationSchema,
  AddPermanentCardStatOperationSchema,
  ApplyStatusOperationSchema,
  RepeatEffectOperationSchema,
  InspectAndReorderDeckOperationSchema,
  ChangeEffectiveValueOperationSchema,
]);

export const EffectConfigSchema = z.object({
  effectId: z.string().min(1),
  timing: z.enum(EFFECT_TIMINGS),
  condition: EffectConditionSchema,
  operations: z.array(EffectOperationSchema).min(1),
});

export type EffectConfig = z.infer<typeof EffectConfigSchema>;
export type EffectCondition = z.infer<typeof EffectConditionSchema>;
export type EffectOperation = z.infer<typeof EffectOperationSchema>;
export type EffectOperationType = EffectOperation['type'];
