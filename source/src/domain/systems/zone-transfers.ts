import type { RngPort } from '../ports/rng-port';
import type { InstanceId } from '../models/ids';
import { withZone } from '../models/card-instance';
import type { GameState } from '../state/game-state';
import type { ZonesState } from '../state/zones-state';
import type { BattleRules } from './battle-rules';
import { shuffleInstances } from './deck-shuffle';

/**
 * 牌区流转。
 *
 * 补牌抽至手牌上限；抽牌堆不足时洗回弃牌堆，移除区与手牌不参与洗牌。
 */

export interface DrawOutcome {
  readonly state: GameState;
  readonly drawn: readonly InstanceId[];
  readonly reshuffledCount: number;
}

/**
 * 按指定张数抽牌；调用方负责计算需要补到多少张。
 */
export function drawCards(state: GameState, rng: RngPort, count: number): DrawOutcome {
  let zones: ZonesState = state.zones;
  let cards = state.cards;
  let rngState = state.rng;
  const drawn: InstanceId[] = [];
  let reshuffledCount = 0;

  for (let index = 0; index < count; index += 1) {
    if (zones.drawPile.length === 0) {
      if (zones.discardPile.length === 0) {
        break;
      }
      const shuffled = shuffleInstances(zones.discardPile, rng, rngState);
      rngState = shuffled.rng;
      reshuffledCount += zones.discardPile.length;
      for (const instanceId of shuffled.items) {
        const instance = cards[instanceId];
        if (instance !== undefined) {
          cards = { ...cards, [instanceId]: withZone(instance, 'drawPile') };
        }
      }
      zones = { ...zones, drawPile: shuffled.items, discardPile: [] };
    }

    const [first, ...rest] = zones.drawPile;
    if (first === undefined) {
      break;
    }
    zones = { ...zones, drawPile: rest, hand: [...zones.hand, first] };
    const instance = cards[first];
    if (instance !== undefined) {
      cards = { ...cards, [first]: withZone(instance, 'hand') };
    }
    drawn.push(first);
  }

  return {
    state: { ...state, zones, cards, rng: rngState },
    drawn,
    reshuffledCount,
  };
}

export function drawToHandLimit(state: GameState, rules: BattleRules, rng: RngPort): DrawOutcome {
  const missing = rules.handLimit - state.zones.hand.length;
  return missing <= 0 ? { state, drawn: [], reshuffledCount: 0 } : drawCards(state, rng, missing);
}

export function moveToZone(
  state: GameState,
  instanceIds: readonly InstanceId[],
  zone: 'hand' | 'drawPile' | 'discardPile' | 'consumed' | 'removed',
): GameState {
  let cards = state.cards;
  for (const instanceId of instanceIds) {
    const instance = cards[instanceId];
    if (instance !== undefined) {
      cards = { ...cards, [instanceId]: withZone(instance, zone) };
    }
  }
  return { ...state, cards };
}
