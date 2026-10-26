import type { RngPort } from '../ports/rng-port';
import type { CardDefinition } from '../models/card-definition';
import type { DefinitionId, InstanceId } from '../models/ids';
import { clearBattleState, withZone } from '../models/card-instance';
import type { GameState } from '../state/game-state';
import type { BattleState } from '../state/battle-state';
import type { BattleEvent } from '../events/battle-events';
import { drawToHandLimit } from './zone-transfers';
import { shuffleInstances } from './deck-shuffle';
import { resolveMoraleTier } from './weapon-matching';
import type { BattleRules } from './battle-rules';

/**
 * 战斗开始。
 *
 * 排除本局移除区，重置资源与残留状态，洗牌并抽至手牌上限，按人物数量锁定军势档位。
 */

export interface StartBattleInput {
  readonly state: GameState;
  readonly rules: BattleRules;
  readonly rng: RngPort;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly enemyDefinitionId: DefinitionId;
  readonly enemyMaxHp: number;
}

export interface DomainOutcome {
  readonly state: GameState;
  readonly events: readonly BattleEvent[];
}

export function startBattle(input: StartBattleInput): DomainOutcome {
  const events: BattleEvent[] = [];

  const excluded = new Set<InstanceId>(input.state.zones.removed);
  const deckInstanceIds: InstanceId[] = [];
  let cards = input.state.cards;
  let characterCount = 0;

  for (const [instanceId, instance] of Object.entries(input.state.cards)) {
    const id = instanceId as InstanceId;
    const definition = input.definitions.get(instance.definitionId);
    const cleaned = withZone(clearBattleState(instance), excluded.has(id) ? 'removed' : 'drawPile');
    cards = { ...cards, [id]: cleaned };
    if (excluded.has(id)) {
      continue;
    }
    deckInstanceIds.push(id);
    if (definition?.cardType === 'character') {
      characterCount += 1;
    }
  }

  const shuffled = shuffleInstances(deckInstanceIds, input.rng, input.state.rng);
  const afterShuffle: GameState = {
    ...input.state,
    cards,
    zones: {
      ...input.state.zones,
      drawPile: shuffled.items,
      hand: [],
      playSlots: input.state.zones.playSlots.map(() => null),
      discardPile: [],
      consumed: [],
    },
    rng: shuffled.rng,
  };

  const drawn = drawToHandLimit(afterShuffle, input.rules, input.rng);
  const moraleTier = resolveMoraleTier(characterCount, input.rules);

  const battle: BattleState = {
    enemyDefinitionId: input.enemyDefinitionId,
    enemyMaxHp: input.enemyMaxHp,
    enemyCurrentHp: input.enemyMaxHp,
    playCountRemaining: input.rules.playCount,
    discardCountRemaining: input.rules.discardCount,
    moraleTier,
    moraleTotal: 0,
    hasDiscardedThisBattle: false,
    status: 'in_progress',
    completedPlays: 0,
  };

  events.push({ type: 'BattleStarted', enemyDefinitionId: input.enemyDefinitionId, maxHp: input.enemyMaxHp });
  if (drawn.drawn.length > 0) {
    events.push({ type: 'CardsDrawn', instanceIds: drawn.drawn });
  }

  return {
    state: { ...drawn.state, battle, equipmentTargets: {}, rng: drawn.state.rng },
    events,
  };
}
