import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err, ok } from '@shared/result';
import type { EffectHandler } from './index';

/**
 * 查看抽牌堆顶若干张并重排。
 *
 * 保持相对顺序，整段搬到顶部或底部；抽牌堆不足时按实际张数处理，不报错。
 * 这是「查看后排序」类技能的最小可用形式，不做任意位置插入。
 */

export const inspectAndReorderDeckHandler: EffectHandler = {
  type: 'inspect_and_reorder_deck',
  apply(ctx, operation) {
    if (operation.type !== 'inspect_and_reorder_deck') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    const drawPile = ctx.state.zones.drawPile;
    if (drawPile.length === 0) {
      return ok(ctx);
    }
    const count = Math.min(operation.count, drawPile.length);
    const inspected = drawPile.slice(0, count);
    const rest = drawPile.slice(count);
    const nextDrawPile =
      operation.to === 'top' ? [...inspected, ...rest] : [...rest, ...inspected];
    return ok({ ...ctx, state: { ...ctx.state, zones: { ...ctx.state.zones, drawPile: nextDrawPile } } });
  },
};
