import type { EffectOperation, EffectOperationType } from '@config/schemas/effect.schema';
import type { AppError } from '@shared/error-codes';
import type { Result } from '@shared/result';
import type { EffectContext } from '../effect-context';
import { addPowerHandler } from './add-power';
import { addAmpHandler } from './add-amp';
import { gainGoldHandler, consumeResourceHandler } from './consume-resource';
import { drawCardsHandler } from './draw-cards';
import { moveCardHandler } from './move-card';
import { addTemporaryStatHandler } from './add-temporary-stat';
import { addPermanentCardStatHandler } from './add-permanent-card-stat';
import { applyStatusHandler } from './apply-status';
import { repeatEffectHandler } from './repeat-effect';
import { inspectAndReorderDeckHandler } from './inspect-and-reorder-deck';
import { changeEffectiveValueHandler } from './change-effective-value';

/**
 * 效果处理器。
 *
 * 每个处理器只做一件事：按配置给出的参数写入上下文，不做条件判断（条件由注册表统一处理），
 * 也不读取上下文之外的数据源。新增卡牌应组合已有操作，只有出现全新机制才新增处理器。
 */

export interface EffectHandler {
  readonly type: EffectOperationType;
  apply(ctx: EffectContext, operation: EffectOperation): Result<EffectContext, AppError>;
}

/**
 * 处理器清单。
 *
 * 顺序即文档顺序，与配置书写顺序无关；结算顺序由效果的 operations 数组决定。
 */
export const EFFECT_HANDLERS: readonly EffectHandler[] = [
  addPowerHandler,
  addAmpHandler,
  gainGoldHandler,
  consumeResourceHandler,
  drawCardsHandler,
  moveCardHandler,
  addTemporaryStatHandler,
  addPermanentCardStatHandler,
  applyStatusHandler,
  repeatEffectHandler,
  inspectAndReorderDeckHandler,
  changeEffectiveValueHandler,
];

export {
  addPowerHandler,
  addAmpHandler,
  gainGoldHandler,
  consumeResourceHandler,
  drawCardsHandler,
  moveCardHandler,
  addTemporaryStatHandler,
  addPermanentCardStatHandler,
  applyStatusHandler,
  repeatEffectHandler,
  inspectAndReorderDeckHandler,
  changeEffectiveValueHandler,
};
