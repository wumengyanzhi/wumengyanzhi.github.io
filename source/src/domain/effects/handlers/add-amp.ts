import type { CardType } from '../../models/enums';
import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err, ok } from '@shared/result';
import {
  addStatByScope,
  addZoneBonus,
  patchInstance,
  readDefinition,
  resolveTarget,
  type EffectContext,
} from '../effect-context';
import type { EffectHandler } from './index';

/**
 * 增加增幅。
 *
 * 与 add_power 同构，只是写入增幅列；增幅是乘区，因此缩放封顶同样必要。
 */

function scaledAmount(ctx: EffectContext, value: number, scale: { countCardType: CardType; each: number; max: number }): number {
  const count = ctx.snapshot.participantIds.filter(
    (instanceId) => readDefinition(ctx, instanceId)?.cardType === scale.countCardType,
  ).length;
  return value + Math.min(scale.max, count * scale.each);
}

export function applyAddAmp(
  ctx: EffectContext,
  operation: Extract<Parameters<EffectHandler['apply']>[1], { type: 'add_amp' }>,
) {
  const amount = operation.scale === undefined ? operation.value : scaledAmount(ctx, operation.value, operation.scale);
  const target = resolveTarget(ctx, operation.target);
  if (target === null) {
    return err(
      createAppError(AppErrorCode.EffectRejected, '效果目标在当前快照下不存在', {
        sourceInstanceId: ctx.scope.sourceInstanceId,
        target: operation.target,
      }),
    );
  }
  if (target.kind === 'zone' || target.instanceId === null) {
    return ok(addZoneBonus(ctx, 0, amount));
  }
  return patchInstance(ctx, target.instanceId, (instance) => addStatByScope(instance, operation.scope, 0, amount));
}

export const addAmpHandler: EffectHandler = {
  type: 'add_amp',
  apply(ctx, operation) {
    if (operation.type !== 'add_amp') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    return applyAddAmp(ctx, operation);
  },
};
