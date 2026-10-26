import type { EconomyBalance } from '@config/schemas/balance.schema';
import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { InstanceId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';
import type { WeaponTargetCandidates } from '@domain/commands/select-target';

/**
 * 命令合法性预检。
 *
 * 只回答三件事：有没有进行中的冒险、资源够不够、目标合不合法，以及当前是否被待处理选择卡住。
 * 格位越界、卡牌不在手牌这类结构性校验仍在领域命令里做——领域是唯一权威，预检不重复实现规则。
 * 预检通过不代表命令一定成功，只代表「值得交给领域跑一次」。
 */

export type GameCommand =
  | { readonly type: 'NewRun'; readonly seed: string }
  | { readonly type: 'StageCard'; readonly instanceId: InstanceId; readonly slotIndex: number }
  | { readonly type: 'UnstageCard'; readonly slotIndex: number }
  | { readonly type: 'SelectWeaponTarget'; readonly weaponInstanceId: InstanceId; readonly targetInstanceId: InstanceId }
  | { readonly type: 'Play'; readonly assignments: readonly { readonly slotIndex: number; readonly instanceId: InstanceId }[] }
  | { readonly type: 'Discard'; readonly instanceIds: readonly InstanceId[] }
  | { readonly type: 'RerollEnhancement' }
  | { readonly type: 'ChooseEnhancement'; readonly candidateId: string };

export interface CommandValidationContext {
  readonly economy: EconomyBalance;
  /** 当前需要玩家指定目标的武器候选；由领域查询得到，预检只做比对。 */
  readonly weaponCandidates: readonly WeaponTargetCandidates[];
}

/** 不受「必须先解决待处理选择」限制的命令：它们本身就是解决选择的手段。 */
function resolvesPendingChoice(command: GameCommand, kind: NonNullable<GameState['pendingChoice']>['kind']): boolean {
  if (kind === 'weapon_target') {
    return command.type === 'SelectWeaponTarget';
  }
  return command.type === 'ChooseEnhancement' || command.type === 'RerollEnhancement';
}

export function validateCommand(
  state: GameState | null,
  command: GameCommand,
  context: CommandValidationContext,
): Result<void, AppError> {
  // 新开冒险不需要既有进度，也不受待处理选择限制。
  if (command.type === 'NewRun') {
    return ok(undefined);
  }
  if (state === null) {
    return err(createAppError(AppErrorCode.CommandRejected, '当前没有进行中的冒险'));
  }
  if (state.run.status !== 'running') {
    return err(createAppError(AppErrorCode.CommandRejected, '本局冒险已经结束'));
  }
  if (state.pendingChoice !== null && !resolvesPendingChoice(command, state.pendingChoice.kind)) {
    return err(createAppError(AppErrorCode.CommandRejected, '请先完成当前选择'));
  }

  if (command.type === 'RerollEnhancement') {
    if (state.pendingChoice === null || state.pendingChoice.kind !== 'enhancement_reward') {
      return err(createAppError(AppErrorCode.CommandRejected, '当前没有可刷新的强化候选'));
    }
    if (state.run.rerollsUsed >= context.economy.maxRerollsPerStage) {
      return err(createAppError(AppErrorCode.CommandRejected, '本阶段刷新次数已用尽', {
        rerollsUsed: state.run.rerollsUsed,
        max: context.economy.maxRerollsPerStage,
      }));
    }
    if (state.run.gold < context.economy.rerollCost) {
      return err(createAppError(AppErrorCode.CommandRejected, '金币不足，无法刷新', {
        gold: state.run.gold,
        cost: context.economy.rerollCost,
      }));
    }
    return ok(undefined);
  }

  if (command.type === 'ChooseEnhancement') {
    const choice = state.pendingChoice;
    if (choice === null || choice.kind !== 'enhancement_reward') {
      return err(createAppError(AppErrorCode.CommandRejected, '当前没有待选择的强化'));
    }
    if (!choice.candidates.some((candidate) => candidate.id === command.candidateId)) {
      return err(createAppError(AppErrorCode.CommandRejected, '所选强化不在候选中', {
        candidateId: command.candidateId,
      }));
    }
    return ok(undefined);
  }

  if (command.type === 'SelectWeaponTarget') {
    const candidates = context.weaponCandidates.find(
      (entry) => entry.weaponInstanceId === command.weaponInstanceId,
    );
    if (candidates === undefined) {
      return err(createAppError(AppErrorCode.InvalidCommand, '该武器当前不需要选择目标', {
        weaponInstanceId: command.weaponInstanceId,
      }));
    }
    if (!candidates.candidateInstanceIds.includes(command.targetInstanceId)) {
      return err(createAppError(AppErrorCode.InvalidCommand, '所选目标不是合法装备对象', {
        weaponInstanceId: command.weaponInstanceId,
        targetInstanceId: command.targetInstanceId,
      }));
    }
  }

  return ok(undefined);
}
