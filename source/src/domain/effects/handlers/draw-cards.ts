import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err } from '@shared/result';
import { drawCardsEffect } from '../effect-context';
import type { EffectHandler } from './index';

/**
 * 抽牌。
 *
 * 抽牌堆不足时由牌区流转统一洗回弃牌堆，抽不到牌不是错误，只是少抽。
 * 需要随机端口，未提供时整条结算被拒，避免用非确定顺序冒充随机。
 */

export const drawCardsHandler: EffectHandler = {
  type: 'draw_cards',
  apply(ctx, operation) {
    if (operation.type !== 'draw_cards') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    return drawCardsEffect(ctx, operation.count);
  },
};
