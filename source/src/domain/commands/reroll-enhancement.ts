import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { EconomyBalance } from '@config/schemas/balance.schema';
import { generateEnhancementCandidates, type GenerateEnhancementInput } from './generate-enhancement';
import type { GameState } from '../state/game-state';

export interface RerollEnhancementInput extends Omit<GenerateEnhancementInput, 'stageId'> {
  readonly economy: EconomyBalance;
}

export function rerollEnhancementCandidates(
  input: RerollEnhancementInput,
): Result<{ state: GameState }, AppError> {
  const choice = input.state.pendingChoice;
  if (choice?.kind !== 'enhancement_reward') {
    return err(createAppError(AppErrorCode.CommandRejected, '当前没有强化候选'));
  }
  if (input.state.run.rerollsUsed >= input.economy.maxRerollsPerStage) {
    return err(createAppError(AppErrorCode.CommandRejected, '本阶段刷新次数已用尽'));
  }
  if (input.state.run.gold < input.economy.rerollCost) {
    return err(createAppError(AppErrorCode.CommandRejected, '金币不足'));
  }
  const generated = generateEnhancementCandidates({
    state: input.state,
    stageId: choice.stageId,
    config: input.config,
    definitions: input.definitions,
    rng: input.rng,
  });
  if (!generated.ok) return generated;
  return ok({
    state: {
      ...generated.value.state,
      run: {
        ...generated.value.state.run,
        gold: generated.value.state.run.gold - input.economy.rerollCost,
        rerollsUsed: generated.value.state.run.rerollsUsed + 1,
      },
    },
  });
}
