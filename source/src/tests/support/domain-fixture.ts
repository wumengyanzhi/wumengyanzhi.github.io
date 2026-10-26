import { createConfigRegistry } from '@config/config-registry';
import { createBattleRules, type BattleRules } from '@domain/systems/battle-rules';
import { createCardDefinition, type CardDefinition } from '@domain/models/card-definition';
import { createCardInstances } from '@domain/models/card-instance-factory';
import { withZone } from '@domain/models/card-instance';
import { createRunState } from '@domain/state/run-state';
import { createZonesState } from '@domain/state/zones-state';
import { createGameState, type GameState } from '@domain/state/game-state';
import { startBattle } from '@domain/systems/battle-setup';
import { asDefinitionId, asRunNodeId, type DefinitionId, type InstanceId } from '@domain/models/ids';
import { createSeededRng } from '@infra/rng/seeded-rng';
import type { RngPort } from '@domain/ports/rng-port';

const registryResult = createConfigRegistry();
if (!registryResult.ok) {
  throw new Error('基础配置未通过验证，测试夹具无法建立。');
}
export const registry = registryResult.value;
export const effectiveConfig = registry.config;
export const rules: BattleRules = createBattleRules(effectiveConfig);
export const rng: RngPort = createSeededRng();

export const definitions: ReadonlyMap<DefinitionId, CardDefinition> = (() => {
  const map = new Map<DefinitionId, CardDefinition>();
  for (const config of registry.listCardDefinitions()) {
    const definition = createCardDefinition(config);
    map.set(definition.id, definition);
  }
  return map;
})();

export const MVP_DECK_DEFINITION_IDS: readonly DefinitionId[] = registry
  .listCardDefinitions()
  .map((card) => asDefinitionId(card.id));

export const HUANG_JIN_ID = asDefinitionId('three_kingdoms.enemy.huang_jin_jun_zhen');
export const HU_LAO_ID = asDefinitionId('three_kingdoms.enemy.hu_lao_mo_jiang');

export interface HarnessOptions {
  readonly seed?: string;
  readonly deckDefinitionIds?: readonly DefinitionId[];
}

export function createPreparedState(options: HarnessOptions = {}): GameState {
  const deckIds = options.deckDefinitionIds ?? MVP_DECK_DEFINITION_IDS;
  const instances = createCardInstances(deckIds);
  const cards: Record<string, (typeof instances)[number]> = {};
  for (const instance of instances) {
    cards[instance.instanceId] = instance;
  }
  const run = createRunState(
    'three_kingdoms.run.three_battle_mvp',
    asRunNodeId('three_kingdoms.run_node.huang_jin_battle'),
    effectiveConfig.economy.initialGold,
  );

  return createGameState({
    contentVersion: effectiveConfig.contentVersion,
    run,
    zones: createZonesState(rules.playSlotCount),
    cards,
    rng: rng.createState(options.seed ?? 'mvp-test-seed'),
  });
}

export function startBattleWith(
  state: GameState,
  enemyDefinitionId: DefinitionId = HUANG_JIN_ID,
  enemyMaxHp?: number,
): GameState {
  const enemy = registry.getEnemyDefinition(enemyDefinitionId);
  const outcome = startBattle({
    state,
    rules,
    rng,
    definitions,
    enemyDefinitionId,
    enemyMaxHp: enemyMaxHp ?? enemy?.maxHp ?? 1000,
  });
  return outcome.state;
}

/** 把指定定义的实例按顺序摆进手牌，其余留在抽牌堆，便于确定性地构造出战场景。 */
export function setHand(state: GameState, definitionIds: readonly DefinitionId[]): GameState {
  const used = new Set<InstanceId>();
  const hand: InstanceId[] = [];
  let cards = state.cards;

  for (const definitionId of definitionIds) {
    const instance = Object.values(state.cards).find(
      (candidate) => candidate.definitionId === definitionId && !used.has(candidate.instanceId),
    );
    if (instance === undefined) {
      throw new Error(`牌组中没有该定义的实例：${definitionId}`);
    }
    used.add(instance.instanceId);
    hand.push(instance.instanceId);
    cards = { ...cards, [instance.instanceId]: withZone(instance, 'hand') };
  }

  return {
    ...state,
    cards,
    zones: { ...state.zones, hand, drawPile: [] },
  };
}

export function instanceIdOfDefinition(state: GameState, definitionId: DefinitionId): InstanceId {
  const instance = Object.values(state.cards).find((candidate) => candidate.definitionId === definitionId);
  if (instance === undefined) {
    throw new Error(`牌组中没有该定义的实例：${definitionId}`);
  }
  return instance.instanceId;
}
