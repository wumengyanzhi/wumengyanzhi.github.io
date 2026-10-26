import type { CardInstance } from '../models/card-instance';
import { clearBattleState, withZone } from '../models/card-instance';
import type { InstanceId } from '../models/ids';
import type { GameState } from '../state/game-state';
import type { BattleEvent } from '../events/battle-events';
import type { DomainOutcome } from './battle-setup';

/**
 * 战斗结束。
 *
 * 清除本场临时状态与军势，牌组重新并回本局有效牌组；移除区继续排除。
 * 本局是否继续推进由流程节点决定，这里只标记战斗结果。
 */
export function endBattle(state: GameState, won: boolean): DomainOutcome {
  const battle = state.battle;
  if (battle === null) {
    return { state, events: [] };
  }

  const events: BattleEvent[] = [];
  let cards = state.cards;
  const deckInstanceIds: InstanceId[] = [];
  const excluded = new Set<InstanceId>(state.zones.removed);

  for (const [instanceId, instance] of Object.entries(state.cards)) {
    const id = instanceId as InstanceId;
    const cleaned: CardInstance = withZone(clearBattleState(instance), excluded.has(id) ? 'removed' : 'drawPile');
    cards = { ...cards, [id]: cleaned };
    if (!excluded.has(id)) {
      deckInstanceIds.push(id);
    }
  }

  events.push({
    type: won ? 'BattleWon' : 'BattleLost',
    enemyDefinitionId: battle.enemyDefinitionId,
  });

  return {
    state: {
      ...state,
      cards,
      battle: { ...battle, status: won ? 'won' : 'lost' },
      run: {
        ...state.run,
        battlesWon: won ? state.run.battlesWon + 1 : state.run.battlesWon,
        status: won ? state.run.status : 'lost',
      },
      zones: {
        ...state.zones,
        drawPile: deckInstanceIds,
        hand: [],
        playSlots: state.zones.playSlots.map(() => null),
        discardPile: [],
        consumed: [],
      },
    },
    events,
  };
}
