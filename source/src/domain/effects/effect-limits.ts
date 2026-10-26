import type { Rarity } from '../models/enums';

/**
 * 效果结算约束。
 *
 * 三条硬约束：
 * 一、同一实体同一技能在一次出战中默认只触发一次，重复触发必须由配置显式声明次数。
 * 二、效果可以嵌套，但深度有上限，且不允许在结算期间开启新的出战。
 * 三、嵌套链上出现已在处理的效果即判定为自循环，整条链作废。
 *
 * 达到上限时返回结构化错误，调用方放弃本次结算的结果，不做部分写入。
 */

/** 嵌套深度上限：repeat 内再 repeat 的层数。 */
export const MAX_EFFECT_DEPTH = 4;
/** 单次 repeat 的重复次数上限。 */
export const MAX_REPEAT_TIMES = 8;
/** 单次结算允许写入的实体数量上限，防止失控的批量增益。 */
export const MAX_PATCHED_INSTANCES = 32;

export type EffectLimitCode =
  | 'EFFECT_DEPTH_EXCEEDED'
  | 'EFFECT_CYCLE_DETECTED'
  | 'EFFECT_NESTED_PLAY_REJECTED'
  | 'EFFECT_ALREADY_USED'
  | 'EFFECT_PERMISSION_DENIED';

export interface EffectLimitViolation {
  readonly code: EffectLimitCode;
  readonly message: string;
  readonly detail: Readonly<Record<string, string | number>>;
}

/** 同一实体同一技能的一次性键：实例 + 效果。 */
export function effectUseKey(instanceId: string, effectId: string): string {
  return `${instanceId}::${effectId}`;
}

/**
 * 本局永久强化的发起权限。
 *
 * 只有来源稀有度达到稀有的卡牌可以发起永久强化；事件卡在 MVP 不参与，
 * 因此不出现在权限表中，后续接入时在此追加。
 */
const PERMANENT_SOURCE_RARITIES: readonly Rarity[] = ['rare', 'epic', 'legendary'];

export function canGrantPermanent(rarity: Rarity): boolean {
  return PERMANENT_SOURCE_RARITIES.includes(rarity);
}

export function checkDepth(depth: number): EffectLimitViolation | null {
  if (depth > MAX_EFFECT_DEPTH) {
    return {
      code: 'EFFECT_DEPTH_EXCEEDED',
      message: '效果嵌套层数超过上限，本次结算已中止',
      detail: { depth, max: MAX_EFFECT_DEPTH },
    };
  }
  return null;
}

/** 嵌套链上已经在处理同一效果即视为自循环。 */
export function checkCycle(
  chain: readonly string[],
  effectId: string,
): EffectLimitViolation | null {
  if (chain.includes(effectId)) {
    return {
      code: 'EFFECT_CYCLE_DETECTED',
      message: '效果自循环，本次结算已中止',
      detail: { effectId, chain: chain.join('>') },
    };
  }
  return null;
}

export function checkRepeatTimes(times: number): EffectLimitViolation | null {
  if (!Number.isInteger(times) || times < 1 || times > MAX_REPEAT_TIMES) {
    return {
      code: 'EFFECT_DEPTH_EXCEEDED',
      message: '重复次数超出允许范围',
      detail: { times, max: MAX_REPEAT_TIMES },
    };
  }
  return null;
}

export function nestedPlayViolation(): EffectLimitViolation {
  return {
    code: 'EFFECT_NESTED_PLAY_REJECTED',
    message: '结算期间不得开启新的出战',
    detail: {},
  };
}

export function alreadyUsedViolation(instanceId: string, effectId: string): EffectLimitViolation {
  return {
    code: 'EFFECT_ALREADY_USED',
    message: '同一实体同一技能在一次出战中只触发一次',
    detail: { instanceId, effectId },
  };
}

export function permissionViolation(instanceId: string, rarity: Rarity): EffectLimitViolation {
  return {
    code: 'EFFECT_PERMISSION_DENIED',
    message: '该卡牌的稀有度不足以发起本局永久强化',
    detail: { instanceId, rarity },
  };
}
