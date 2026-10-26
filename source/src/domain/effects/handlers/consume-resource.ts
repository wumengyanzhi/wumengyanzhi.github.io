import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err, ok } from '@shared/result';
import { addGold, emit, spendGold } from '../effect-context';
import type { EffectHandler } from './index';

/**
 * 资源增减。
 *
 * 产出与消耗放在同一个处理器里，保证「先扣后加」的顺序不会被配置书写顺序打乱。
 * MVP 只有金币一种资源，resource 字段预留给后续资源类型。
 */

export function applyGainGold(ctx: Parameters<EffectHandler['apply']>[0], amount: number) {
  return ok(emit(addGold(ctx, amount), { type: 'GoldGained', amount }));
}

export const gainGoldHandler: EffectHandler = {
  type: 'gain_gold',
  apply(ctx, operation) {
    if (operation.type !== 'gain_gold') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    return applyGainGold(ctx, operation.value);
  },
};

export const consumeResourceHandler: EffectHandler = {
  type: 'consume_resource',
  apply(ctx, operation) {
    if (operation.type !== 'consume_resource') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    if (operation.resource !== 'gold') {
      return err(
        createAppError(AppErrorCode.EffectRejected, 'MVP 不支持该资源类型', { resource: operation.resource }),
      );
    }
    return spendGold(ctx, operation.amount);
  },
};
