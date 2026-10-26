import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err } from '@shared/result';
import { moveInstance, resolveTarget } from '../effect-context';
import type { EffectHandler } from './index';

/**
 * 移动卡牌。
 *
 * 只改牌区归属，不改快照：本次出战已经用快照锁定了位置与相邻关系，
 * 因此不允许移入出牌框，配置层的 to 也不提供该取值。
 */

export const moveCardHandler: EffectHandler = {
  type: 'move_card',
  apply(ctx, operation) {
    if (operation.type !== 'move_card') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    const target = resolveTarget(ctx, operation.target);
    if (target === null || target.instanceId === null) {
      return err(
        createAppError(AppErrorCode.EffectRejected, '被移动的卡牌目标不存在', { target: operation.target }),
      );
    }
    return moveInstance(ctx, target.instanceId, operation.to);
  },
};
