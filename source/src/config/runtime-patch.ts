import { z } from 'zod';
import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import { ENHANCEMENT_TIERS, MATCH_RELATIONS } from '@domain/models/enums';
import type { CardDefinitionConfig } from './schemas/card.schema';
import type { EnemyDefinitionConfig } from './schemas/enemy.schema';
import type { EffectiveConfig } from './config-registry';

/**
 * 开发期调参补丁。
 *
 * EffectiveConfig = BaseConfig + RuntimePatch。
 * 补丁只覆盖可热更新的数值与开关；ID、卡牌类型、效果类型、字段结构与引用关系属于结构性配置，
 * 在本 Schema 中根本没有入口，因此尝试打补丁会在校验阶段被明确拒绝。
 */

const NonNegativeInt = z.number().int().nonnegative();
const PositiveInt = z.number().int().positive();

export const STRUCTURAL_PATCH_MESSAGE =
  '结构性配置不可热更新：ID、卡牌类型、效果类型、字段结构与引用关系只能在重新加载内容或新战斗开始时生效。';

export const RuntimePatchSchema = z.strictObject({
  cardStats: z
    .record(
      z.string().min(1),
      z.strictObject({
        basePower: NonNegativeInt.optional(),
        baseAmp: NonNegativeInt.optional(),
      }),
    )
    .optional(),
  enemyStats: z
    .record(
      z.string().min(1),
      z.strictObject({
        maxHp: z.number().int().positive().optional(),
      }),
    )
    .optional(),
  balance: z
    .strictObject({
      battle: z
        .strictObject({
          handLimit: NonNegativeInt.optional(),
          playCount: NonNegativeInt.optional(),
          discardCount: NonNegativeInt.optional(),
          playSlotCount: NonNegativeInt.optional(),
          maxDiscardSelection: NonNegativeInt.optional(),
        })
        .optional(),
      damage: z
        .strictObject({
          basePower: NonNegativeInt.optional(),
          baseAmp: NonNegativeInt.optional(),
        })
        .optional(),
      morale: z
        .strictObject({
          noneMaxCharacterCount: NonNegativeInt.optional(),
          formedMaxCharacterCount: PositiveInt.optional(),
          powerPerPoint: NonNegativeInt.optional(),
          ampPerPoints: PositiveInt.optional(),
        })
        .optional(),
      matchMatrix: z
        .strictObject({
          relationAmp: z.record(z.enum(MATCH_RELATIONS), NonNegativeInt).optional(),
        })
        .optional(),
      economy: z
        .strictObject({
          initialGold: NonNegativeInt.optional(),
          victoryGold: NonNegativeInt.optional(),
          rerollCost: NonNegativeInt.optional(),
          maxRerollsPerStage: NonNegativeInt.optional(),
        })
        .optional(),
      enhancement: z
        .strictObject({
          candidateCount: PositiveInt.optional(),
          /** 档位权重：键为奖励阶段标识，值为三档权重。 */
          stageWeights: z
            .record(z.string().min(1), z.record(z.enum(ENHANCEMENT_TIERS), NonNegativeInt))
            .optional(),
          tierValues: z
            .record(
              z.enum(ENHANCEMENT_TIERS),
              z.strictObject({ power: NonNegativeInt, amp: NonNegativeInt }),
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
  presentation: z
    .strictObject({
      animationEnabled: z.boolean().optional(),
      damageTickMs: NonNegativeInt.optional(),
      cardMoveMs: NonNegativeInt.optional(),
      cardFlipMs: NonNegativeInt.optional(),
      glowFadeMs: NonNegativeInt.optional(),
      drag: z
        .strictObject({
          startThresholdPx: NonNegativeInt.optional(),
          snapDistancePx: NonNegativeInt.optional(),
        })
        .optional(),
      card: z
        .strictObject({
          hoverScale: z.number().positive().optional(),
          glowIntensity: z.number().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type RuntimePatch = z.infer<typeof RuntimePatchSchema>;

export interface PatchRejection {
  readonly path: string;
  readonly message: string;
}

export function validateRuntimePatch(raw: unknown): Result<RuntimePatch, PatchRejection[]> {
  const parsed = RuntimePatchSchema.safeParse(raw);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.code === 'unrecognized_keys' ? STRUCTURAL_PATCH_MESSAGE : issue.message,
    })),
  );
}

export function applyRuntimePatch(
  base: EffectiveConfig,
  patch: RuntimePatch,
): Result<EffectiveConfig, PatchRejection[]> {
  const rejections: PatchRejection[] = [];

  const cards = new Map<string, CardDefinitionConfig>(base.cards);
  for (const [id, stats] of Object.entries(patch.cardStats ?? {})) {
    const definition = cards.get(id);
    if (definition === undefined) {
      rejections.push({ path: `cardStats.${id}`, message: `补丁引用了不存在的卡牌定义：${id}` });
      continue;
    }
    const next: CardDefinitionConfig = {
      ...definition,
      ...(stats.basePower === undefined ? {} : { basePower: stats.basePower }),
      ...(stats.baseAmp === undefined || !('baseAmp' in definition) ? {} : { baseAmp: stats.baseAmp }),
    };
    cards.set(id, next);
  }

  const enemies = new Map<string, EnemyDefinitionConfig>(base.enemies);
  for (const [id, stats] of Object.entries(patch.enemyStats ?? {})) {
    const definition = enemies.get(id);
    if (definition === undefined) {
      rejections.push({ path: `enemyStats.${id}`, message: `补丁引用了不存在的敌人定义：${id}` });
      continue;
    }
    enemies.set(id, { ...definition, ...(stats.maxHp === undefined ? {} : { maxHp: stats.maxHp }) });
  }

  if (rejections.length > 0) {
    return err(rejections);
  }

  const patchBalance = patch.balance ?? {};
  const patchPresentation = patch.presentation ?? {};
  const patchEnhancement = patchBalance.enhancement ?? {};

  return ok({
    ...base,
    cards,
    enemies,
    battle: { ...base.battle, ...(patchBalance.battle ?? {}) },
    damage: { ...base.damage, ...(patchBalance.damage ?? {}) },
    morale: { ...base.morale, ...(patchBalance.morale ?? {}) },
    matchMatrix: {
      ...base.matchMatrix,
      relationAmp: { ...base.matchMatrix.relationAmp, ...(patchBalance.matchMatrix?.relationAmp ?? {}) },
    },
    economy: { ...base.economy, ...(patchBalance.economy ?? {}) },
    enhancement: {
      ...base.enhancement,
      ...(patchEnhancement.candidateCount === undefined ? {} : { candidateCount: patchEnhancement.candidateCount }),
      stageWeights: { ...base.enhancement.stageWeights, ...(patchEnhancement.stageWeights ?? {}) },
      tierValues: { ...base.enhancement.tierValues, ...(patchEnhancement.tierValues ?? {}) },
    },
    presentation: {
      ...base.presentation,
      animation: {
        ...base.presentation.animation,
        ...(patchPresentation.animationEnabled === undefined
          ? {}
          : { enabled: patchPresentation.animationEnabled }),
        ...(patchPresentation.damageTickMs === undefined ? {} : { damageTickMs: patchPresentation.damageTickMs }),
        ...(patchPresentation.cardMoveMs === undefined ? {} : { cardMoveMs: patchPresentation.cardMoveMs }),
        ...(patchPresentation.cardFlipMs === undefined ? {} : { cardFlipMs: patchPresentation.cardFlipMs }),
        ...(patchPresentation.glowFadeMs === undefined ? {} : { glowFadeMs: patchPresentation.glowFadeMs }),
      },
      drag: { ...base.presentation.drag, ...(patchPresentation.drag ?? {}) },
      card: { ...base.presentation.card, ...(patchPresentation.card ?? {}) },
    },
  });
}

export function exportRuntimePatch(patch: RuntimePatch): string {
  return JSON.stringify(patch, null, 2);
}

export function patchRejectionsToAppError(rejections: readonly PatchRejection[]): ReturnType<typeof createAppError> {
  return createAppError(AppErrorCode.ConfigInvalid, '调参补丁被拒绝', {
    rejectionCount: rejections.length,
    firstPath: rejections[0]?.path ?? '',
  });
}
