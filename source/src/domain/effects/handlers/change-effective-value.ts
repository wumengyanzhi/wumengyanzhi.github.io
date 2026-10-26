import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err } from '@shared/result';
import {
  absorbableAmp,
  absorbablePower,
  addStatByScope,
  patchInstance,
  resolveTarget,
} from '../effect-context';
import type { EffectHandler } from './index';

/**
 * 吸收另一张卡的数值。
 *
 * 只读目标的基础与本局永久两层：本场临时与本次加成随出战结束而消失，
 * 若允许被吸收，同一份加成会被反复复制放大。
 *
 * 吸收量不写回目标，目标数值不变；结果写入发起者的指定数值层。
 */

export const changeEffectiveValueHandler: EffectHandler = {
  type: 'change_effective_value',
  apply(ctx, operation) {
    if (operation.type !== 'change_effective_value') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    const from = resolveTarget(ctx, operation.from);
    if (from === null || from.instanceId === null) {
      return err(
        createAppError(AppErrorCode.EffectRejected, '吸收来源在当前快照下不存在', { from: operation.from }),
      );
    }
    if (from.instanceId === ctx.scope.sourceInstanceId) {
      return err(
        createAppError(AppErrorCode.EffectRejected, '不得吸收自身数值', {
          instanceId: ctx.scope.sourceInstanceId,
        }),
      );
    }
    const amount =
      operation.mode === 'absorb_power'
        ? absorbablePower(ctx, from.instanceId)
        : absorbableAmp(ctx, from.instanceId);
    const power = operation.mode === 'absorb_power' ? amount : 0;
    const amp = operation.mode === 'absorb_amp' ? amount : 0;
    return patchInstance(ctx, ctx.scope.sourceInstanceId, (instance) =>
      addStatByScope(instance, operation.scope, power, amp),
    );
  },
};
