import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { RngPort } from '../ports/rng-port';
import type { InstanceId } from '../models/ids';
import { withZone } from '../models/card-instance';
import type { GameState } from '../state/game-state';
import type { BattleEvent } from '../events/battle-events';
import type { BattleRules } from '../systems/battle-rules';
import { drawCards } from '../systems/zone-transfers';
import type { DomainOutcome } from '../systems/battle-setup';

/**
 * 主动弃牌。
 *
 * 消耗一次弃牌次数，所选卡进入弃牌堆并补抽等量；不属于出战，不获得军势。
 */
export interface DiscardCardsInput {
  readonly state: GameState;
  readonly rules: BattleRules;
  readonly rng: RngPort;
  readonly instanceIds: readonly InstanceId[];
}

export function discardCards(input: DiscardCardsInput): Result<DomainOutcome, AppError> {
  const { state, rules, rng } = input;
  const battle = state.battle;
  if (battle === null) {
    return err(createAppError(AppErrorCode.CommandRejected, '当前不在战斗中，无法弃牌'));
  }
  if (battle.status !== 'in_progress') {
    return err(createAppError(AppErrorCode.CommandRejected, '本场战斗已经结束'));
  }
  if (battle.discardCountRemaining <= 0) {
    return err(createAppError(AppErrorCode.CommandRejected, '弃牌次数已用尽'));
  }
  if (input.instanceIds.length === 0) {
    return err(createAppError(AppErrorCode.InvalidCommand, '至少需要选择一张卡'));
  }
  if (input.instanceIds.length > rules.maxDiscardSelection) {
    return err(createAppError(AppErrorCode.InvalidCommand, '一次弃牌数量超过上限', {
      maxDiscardSelection: rules.maxDiscardSelection,
    }));
  }

  const selected = new Set<InstanceId>();
  for (const instanceId of input.instanceIds) {
    if (selected.has(instanceId)) {
      return err(createAppError(AppErrorCode.InvalidCommand, '同一张卡被重复选择', { instanceId }));
    }
    selected.add(instanceId);
    const instance = state.cards[instanceId];
    if (instance === undefined || instance.zone !== 'hand') {
      return err(createAppError(AppErrorCode.InvalidCommand, '所选卡牌不在手牌区', { instanceId }));
    }
  }

  let cards = state.cards;
  for (const instanceId of input.instanceIds) {
    const instance = cards[instanceId];
    if (instance !== undefined) {
      cards = { ...cards, [instanceId]: withZone(instance, 'discardPile', null) };
    }
  }

  const afterDiscard: GameState = {
    ...state,
    cards,
    zones: {
      ...state.zones,
      hand: state.zones.hand.filter((instanceId) => !selected.has(instanceId)),
      discardPile: [...state.zones.discardPile, ...input.instanceIds],
    },
    battle: {
      ...battle,
      discardCountRemaining: battle.discardCountRemaining - 1,
      hasDiscardedThisBattle: true,
    },
  };

  const drawn = drawCards(afterDiscard, rng, input.instanceIds.length);
  const events: BattleEvent[] = [{ type: 'CardsDiscarded', instanceIds: [...input.instanceIds] }];
  if (drawn.reshuffledCount > 0) {
    events.push({ type: 'DeckReshuffled', count: drawn.reshuffledCount });
  }
  if (drawn.drawn.length > 0) {
    events.push({ type: 'CardsDrawn', instanceIds: drawn.drawn });
  }

  return ok({ state: drawn.state, events });
}
