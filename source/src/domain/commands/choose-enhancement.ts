import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import { addEnhancementSkill, addPermanentStats } from '../models/card-instance';
import type { GameState } from '../state/game-state';

export function chooseEnhancement(
  state: GameState,
  candidateId: string,
): Result<{ state: GameState }, AppError> {
  const choice = state.pendingChoice;
  if (choice?.kind !== 'enhancement_reward') {
    return err(createAppError(AppErrorCode.CommandRejected, '当前没有强化候选'));
  }
  const candidate = choice.candidates.find((entry) => entry.id === candidateId);
  if (candidate === undefined) {
    return err(createAppError(AppErrorCode.InvalidCommand, '强化候选不存在'));
  }
  const instance = state.cards[candidate.targetInstanceId];
  if (instance === undefined || state.zones.removed.includes(candidate.targetInstanceId)) {
    return err(createAppError(AppErrorCode.InvalidCommand, '强化目标已失效'));
  }
  let reinforced = addPermanentStats(
    instance,
    candidate.attribute === 'power' ? candidate.amount : 0,
    candidate.attribute === 'amp' ? candidate.amount : 0,
  );
  if (candidate.skillId !== null) {
    reinforced = addEnhancementSkill(reinforced, candidate.skillId);
  }
  return ok({
    state: {
      ...state,
      cards: { ...state.cards, [candidate.targetInstanceId]: reinforced },
      pendingChoice: null,
    },
  });
}
