import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err, ok } from '@shared/result';
import { descend, forgetUse, readDefinition } from '../effect-context';
import { checkCycle, checkDepth, checkRepeatTimes, nestedPlayViolation } from '../effect-limits';
import type { EffectHandler } from './index';

/**
 * 重复另一个效果。
 *
 * 三条约束：次数有上限；嵌套深度有上限；被重复的效果不得已经在当前链上（自循环）。
 * 结算期间不得开启新的出战——这里只能重复同一张卡上的效果，不能触发一次出战。
 */

function limitError(message: string, detail: Readonly<Record<string, string | number>>) {
  return err(createAppError(AppErrorCode.EffectRejected, message, detail));
}

export const repeatEffectHandler: EffectHandler = {
  type: 'repeat_effect',
  apply(ctx, operation) {
    if (operation.type !== 'repeat_effect') {
      return err(createAppError(AppErrorCode.EffectRejected, '操作类型与处理器不匹配', { type: operation.type }));
    }
    if (ctx.resolveEffect === null) {
      return err(
        createAppError(AppErrorCode.EffectRejected, nestedPlayViolation().message, {
          effectId: operation.effectId,
        }),
      );
    }

    const timesCheck = checkRepeatTimes(operation.times);
    if (timesCheck !== null) {
      return limitError(timesCheck.message, timesCheck.detail);
    }
    // 链上还没有当前效果自身（descend 之后才写入），自引用必须在这里就拦住，
    // 否则会被「一次出战只触发一次」静默吞掉，看不到自循环。
    const cycle = checkCycle([...ctx.chain, ctx.scope.effectId], operation.effectId);
    if (cycle !== null) {
      return limitError(cycle.message, cycle.detail);
    }
    const depth = checkDepth(ctx.depth + 1);
    if (depth !== null) {
      return limitError(depth.message, { ...depth.detail, effectId: operation.effectId });
    }

    const definition = readDefinition(ctx, ctx.scope.sourceInstanceId);
    const target = definition?.effects.find((effect) => effect.effectId === operation.effectId);
    if (definition === undefined || target === undefined) {
      return limitError('被重复的效果不在同一张卡上', {
        effectId: operation.effectId,
        sourceInstanceId: ctx.scope.sourceInstanceId,
      });
    }

    let working = descend(ctx, operation.effectId);
    for (let round = 0; round < operation.times; round += 1) {
      // 「一次出战只触发一次」是默认约束，repeat_effect 是配置写明的例外，
      // 因此每一轮都要先撤销触发记录，否则第一轮之后会被静默跳过。
      const repeatable = forgetUse(working, ctx.scope.sourceInstanceId, operation.effectId);
      const resolved = ctx.resolveEffect(repeatable, target);
      if (!resolved.ok) {
        return resolved;
      }
      working = resolved.value;
    }
    return ok(working);
  },
};
