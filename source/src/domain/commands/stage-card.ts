import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import { pruneEquipmentTargets } from '../systems/weapon-matching';
import type { InstanceId } from '../models/ids';
import { withZone } from '../models/card-instance';
import type { GameState } from '../state/game-state';

/**
 * 摆牌与撤牌。
 *
 * 出牌框一变，配属就要重新判定，但只作废「已经不成立」的那些：
 * 武器和目标都还在、且仍然紧邻，这条配属继续作数，玩家不会被要求反复指定。
 */

export function stageCard(
  state: GameState,
  instanceId: InstanceId,
  slotIndex: number,
): Result<GameState, AppError> {
  if (state.battle?.status !== 'in_progress') {
    return err(createAppError(AppErrorCode.CommandRejected, '当前不在战斗中'));
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= state.zones.playSlots.length) {
    return err(createAppError(AppErrorCode.InvalidCommand, '出牌框格位越界'));
  }
  if (state.zones.playSlots[slotIndex] !== null) {
    return err(createAppError(AppErrorCode.InvalidCommand, '出牌框格位已经占用'));
  }
  const instance = state.cards[instanceId];
  if (instance?.zone !== 'hand' || !state.zones.hand.includes(instanceId)) {
    return err(createAppError(AppErrorCode.InvalidCommand, '卡牌不在手牌区'));
  }
  const slots = [...state.zones.playSlots];
  slots[slotIndex] = instanceId;
  return ok({
    ...state,
    cards: { ...state.cards, [instanceId]: withZone(instance, 'playSlot', slotIndex) },
    zones: { ...state.zones, hand: state.zones.hand.filter((id) => id !== instanceId), playSlots: slots },
    equipmentTargets: pruneEquipmentTargets(slots, state.equipmentTargets),
  });
}

export function unstageCard(state: GameState, slotIndex: number): Result<GameState, AppError> {
  if (state.battle?.status !== 'in_progress') {
    return err(createAppError(AppErrorCode.CommandRejected, '当前不在战斗中'));
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= state.zones.playSlots.length) {
    return err(createAppError(AppErrorCode.InvalidCommand, '出牌框格位越界'));
  }
  const instanceId = state.zones.playSlots[slotIndex];
  const instance = instanceId === null || instanceId === undefined ? undefined : state.cards[instanceId];
  if (instanceId === null || instanceId === undefined || instance === undefined) {
    return err(createAppError(AppErrorCode.InvalidCommand, '出牌框格位为空'));
  }
  const slots = [...state.zones.playSlots];
  slots[slotIndex] = null;
  return ok({
    ...state,
    cards: { ...state.cards, [instanceId]: withZone(instance, 'hand') },
    zones: { ...state.zones, hand: [...state.zones.hand, instanceId], playSlots: slots },
    equipmentTargets: pruneEquipmentTargets(slots, state.equipmentTargets),
  });
}
