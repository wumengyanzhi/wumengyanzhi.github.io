import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err } from '@shared/result';
import { patchInstance, resolveTarget } from '../effect-context';
import type { StatusStack } from '../../models/card-instance';
import type { EffectHandler } from './index';

/**
 * 施加状态。
 *
 * 同一状态叠加层数而不是新增一条记录；剩余次数取已有与新增中较大的那个，
 * 避免重复施加把还有次数的状态提前用尽。
 */

function withStatus(statuses: readonly StatusStack[], next: StatusStack): readonly StatusStack[] {
  const existing = statuses.find((entry) => entry.statusId === next.statusId);
  if (existing === undefined) {
    return [...statuses, next];
  }
  const remainingUses =
    existing.remainingUses === null || next.remainingUses === null
      ? null
      : Math.max(existing.remainingUses, next.remainingUses);
  return statuses.map((entry) =>
    entry.statusId === next.statusId
      ? { ...entry, stacks: entry.stacks + next.stacks, remainingUses }
      : entry,
  );
}

export const applyStatusHandler: EffectHandler = {
  type: 'apply_status',
  apply(ctx, operation) {
    if (operation.type !== 'apply_status') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    const target = resolveTarget(ctx, operation.target);
    if (target === null || target.instanceId === null) {
      return err(
        createAppError(AppErrorCode.EffectRejected, '状态必须施加到具体卡牌', { target: operation.target }),
      );
    }
    const stack: StatusStack = {
      statusId: operation.statusId,
      stacks: operation.stacks,
      remainingUses: operation.remainingUses,
    };
    return patchInstance(ctx, target.instanceId, (instance) => ({
      ...instance,
      statuses: withStatus(instance.statuses, stack),
    }));
  },
};
