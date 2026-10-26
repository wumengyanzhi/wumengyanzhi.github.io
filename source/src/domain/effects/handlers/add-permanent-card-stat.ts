import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err } from '@shared/result';
import { addStatByScope, patchInstance, readDefinition, resolveTarget } from '../effect-context';
import { canGrantPermanent, permissionViolation } from '../effect-limits';
import type { EffectHandler } from './index';

/**
 * 本局永久强化。
 *
 * 写入具体实体，跨战斗保留，因此按来源稀有度拦截：普通卡不能发起永久强化。
 * 事件卡的权限不在这里，事件系统接入时单独追加。
 *
 * 目标必须是具体实体：永久强化落到「本次出战整体」没有意义，配置也不允许该写法。
 */

export const addPermanentCardStatHandler: EffectHandler = {
  type: 'add_permanent_card_stat',
  apply(ctx, operation) {
    if (operation.type !== 'add_permanent_card_stat') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    const sourceDefinition = readDefinition(ctx, ctx.scope.sourceInstanceId);
    if (sourceDefinition === undefined) {
      return err(
        createAppError(AppErrorCode.EffectRejected, '永久强化的发起者不存在', {
          instanceId: ctx.scope.sourceInstanceId,
        }),
      );
    }
    if (!canGrantPermanent(sourceDefinition.rarity)) {
      return err(
        createAppError(
          AppErrorCode.EffectRejected,
          permissionViolation(ctx.scope.sourceInstanceId, sourceDefinition.rarity).message,
          { rarity: sourceDefinition.rarity, instanceId: ctx.scope.sourceInstanceId },
        ),
      );
    }
    const target = resolveTarget(ctx, operation.target);
    if (target === null || target.instanceId === null) {
      return err(
        createAppError(AppErrorCode.EffectRejected, '本局永久强化必须指定具体卡牌', {
          target: operation.target,
        }),
      );
    }
    return patchInstance(ctx, target.instanceId, (instance) =>
      addStatByScope(instance, 'permanent', operation.power, operation.amp),
    );
  },
};
