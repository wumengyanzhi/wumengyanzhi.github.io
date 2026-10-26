import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err, ok } from '@shared/result';
import { addStatByScope, addZoneBonus, patchInstance, resolveTarget } from '../effect-context';
import type { EffectHandler } from './index';

/**
 * 本场临时加成。
 *
 * 写入实体的本场临时层，跟随实体穿过牌区，战斗结束清除。
 * 与 add_power 的 this_battle 作用域等价，独立成处理器是为了让「临时」在配置里一眼可见。
 */

export const addTemporaryStatHandler: EffectHandler = {
  type: 'add_temporary_stat',
  apply(ctx, operation) {
    if (operation.type !== 'add_temporary_stat') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    const target = resolveTarget(ctx, operation.target);
    if (target === null) {
      return err(
        createAppError(AppErrorCode.EffectRejected, '效果目标在当前快照下不存在', { target: operation.target }),
      );
    }
    if (target.kind === 'zone' || target.instanceId === null) {
      return ok(addZoneBonus(ctx, operation.power, operation.amp));
    }
    return patchInstance(ctx, target.instanceId, (instance) =>
      addStatByScope(instance, 'this_battle', operation.power, operation.amp),
    );
  },
};
