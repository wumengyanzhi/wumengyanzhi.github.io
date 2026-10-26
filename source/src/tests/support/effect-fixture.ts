import type { CardDefinitionConfig } from '@config/schemas/card.schema';
import { createCardDefinition, type CardDefinition } from '@domain/models/card-definition';
import { createCardInstances } from '@domain/models/card-instance-factory';
import { withZone, type CardInstance } from '@domain/models/card-instance';
import { asDefinitionId, asRunNodeId, type DefinitionId, type InstanceId } from '@domain/models/ids';
import type { BattleState } from '@domain/state/battle-state';
import { createGameState, type GameState } from '@domain/state/game-state';
import { createRunState } from '@domain/state/run-state';
import { createZonesState } from '@domain/state/zones-state';
import { buildPlaySnapshot, type PlaySnapshot } from '@domain/systems/play-snapshot';
import type { EquipBinding } from '@domain/systems/weapon-matching';
import { createEffectContext, type EffectContext } from '@domain/effects/effect-context';
import { applyEffect } from '@domain/effects/effect-registry';
import { createSeededRng } from '@infra/rng/seeded-rng';
import type { EffectTiming } from '@domain/models/enums';

/**
 * 效果系统测试夹具。
 *
 * 不加载真实卡池，直接按测试需要拼定义与实例，避免改动一处配置牵连全部用例。
 * 实例 ID 由实例工厂生成，顺序与传入的定义顺序一致。
 */

export const TEST_BATTLE: BattleState = {
  enemyDefinitionId: asDefinitionId('test.enemy.dummy'),
  enemyMaxHp: 1000,
  enemyCurrentHp: 1000,
  playCountRemaining: 4,
  discardCountRemaining: 3,
  moraleTier: 'none',
  moraleTotal: 0,
  hasDiscardedThisBattle: false,
  status: 'in_progress',
  completedPlays: 0,
};

export interface HarnessOptions {
  readonly cards: readonly CardDefinitionConfig[];
  /** 进入出牌框的实例索引；null 表示空位；未出现的卡进入手牌。 */
  readonly slots: readonly (number | null)[];
  readonly gold?: number;
  readonly bindings?: readonly EquipBinding[];
  readonly seed?: string;
  readonly hasDiscardedThisBattle?: boolean;
}

export interface EffectHarness {
  readonly state: GameState;
  readonly snapshot: PlaySnapshot;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly bindings: readonly EquipBinding[];
  /** 按定义顺序取实例 ID。 */
  readonly idAt: (index: number) => InstanceId;
  /** 按定义顺序取实例，找不到时抛出。 */
  readonly cardAt: (index: number) => CardInstance;
}

export function buildDefinitions(configs: readonly CardDefinitionConfig[]): Map<DefinitionId, CardDefinition> {
  const map = new Map<DefinitionId, CardDefinition>();
  for (const config of configs) {
    const definition = createCardDefinition(config);
    map.set(definition.id, definition);
  }
  return map;
}

export function createEffectHarness(options: HarnessOptions): EffectHarness {
  const definitions = buildDefinitions(options.cards);
  const instances = createCardInstances([...definitions.keys()]);
  const orderedIds: readonly InstanceId[] = instances.map((instance) => instance.instanceId);

  const slots = options.slots.map((entry) => (entry === null ? null : orderedIds[entry] ?? null));
  const inSlots = new Set(slots.filter((entry): entry is InstanceId => entry !== null));
  const hand = orderedIds.filter((id) => !inSlots.has(id));

  const cards: Record<string, CardInstance> = {};
  for (const instance of instances) {
    const slotIndex = slots.findIndex((entry) => entry === instance.instanceId);
    cards[instance.instanceId] =
      slotIndex >= 0 ? withZone(instance, 'playSlot', slotIndex) : withZone(instance, 'hand');
  }

  const battle: BattleState =
    options.hasDiscardedThisBattle === true
      ? { ...TEST_BATTLE, hasDiscardedThisBattle: true }
      : TEST_BATTLE;

  const state = createGameState({
    contentVersion: 'test-content',
    run: createRunState('test.run', asRunNodeId('test.node'), options.gold ?? 0),
    zones: { ...createZonesState(slots.length), hand, playSlots: slots },
    cards,
    rng: createSeededRng().createState(options.seed ?? 'effect-test-seed'),
    battle,
  });

  const snapshot = buildPlaySnapshot(slots, hand, cards, battle, {});
  const bindings = options.bindings ?? [];

  return {
    state,
    snapshot,
    definitions,
    bindings,
    idAt: (index) => {
      const id = orderedIds[index];
      if (id === undefined) {
        throw new Error(`测试夹具没有第 ${index} 张卡`);
      }
      return id;
    },
    cardAt: (index) => {
      const id = orderedIds[index];
      const instance = id === undefined ? undefined : cards[id];
      if (instance === undefined) {
        throw new Error(`测试夹具没有第 ${index} 张卡`);
      }
      return instance;
    },
  };
}

export interface ContextOptions {
  readonly sourceIndex?: number;
  readonly timing?: EffectTiming;
  readonly effectId?: string;
  readonly rng?: ReturnType<typeof createSeededRng> | null;
}

export function contextFrom(harness: EffectHarness, options: ContextOptions = {}): EffectContext {
  return createEffectContext({
    state: harness.state,
    snapshot: harness.snapshot,
    definitions: harness.definitions,
    bindings: harness.bindings,
    rng: options.rng === undefined ? createSeededRng() : options.rng,
    resolveEffect: applyEffect,
    scope: {
      timing: (options.timing ?? 'on_play') satisfies EffectTiming,
      sourceInstanceId: harness.idAt(options.sourceIndex ?? 0),
      effectId: options.effectId ?? '',
      operationIndex: 0,
    },
  });
}
