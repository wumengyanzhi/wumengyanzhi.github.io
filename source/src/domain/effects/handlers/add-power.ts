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
 * 增加威力。
 *
 * target 为 zone 时计入本次出战整体，不落在实体上；其余目标按 scope 写入对应数值层。
 * scale 允许按本次出战中某类卡的数量追加，追加量受 max 封顶。
 */

function scaledAmount(ctx: EffectContext, value: number, scale: { countCardType: CardType; each: number; max: number }): number {
  const count = ctx.snapshot.participantIds.filter(
    (instanceId) => readDefinition(ctx, instanceId)?.cardType === scale.countCardType,
  ).length;
  return value + Math.min(scale.max, count * scale.each);
}

export function applyAddPower(
  ctx: EffectContext,
  operation: Extract<Parameters<EffectHandler['apply']>[1], { type: 'add_power' }>,
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
    return ok(addZoneBonus(ctx, amount, 0));
  }
  return patchInstance(ctx, target.instanceId, (instance) => addStatByScope(instance, operation.scope, amount, 0));
}

export const addPowerHandler: EffectHandler = {
  type: 'add_power',
  apply(ctx, operation) {
    if (operation.type !== 'add_power') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    return applyAddPower(ctx, operation);
  },
};
