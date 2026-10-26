import { describe, expect, it } from 'vitest';
import type { CardDefinitionConfig } from '@config/schemas/card.schema';
import type { EffectConfig } from '@config/schemas/effect.schema';
import { AppErrorCode } from '@shared/error-codes';
import { isErr } from '@shared/result';
import type { GameState } from '@domain/state/game-state';
import type { InstanceId } from '@domain/models/ids';
import { MAX_EFFECT_DEPTH } from '@domain/effects/effect-limits';
import { applyEffect, resolveEffects, KNOWN_EFFECT_OPERATION_TYPES } from '@domain/effects/effect-registry';
import { contextFrom, createEffectHarness } from '../../support/effect-fixture';

/**
 * 效果注册表：结算顺序、条件判定、一次性约束、嵌套上限与失败回滚。
 */

function characterWith(id: string, effects: readonly EffectConfig[], rarity: 'common' | 'rare' = 'rare'): CardDefinitionConfig {
  return {
    id,
    name: id,
    cardType: 'character',
    rarity,
    faction: 'shu',
    profession: 'warrior',
    basePower: 10,
    effects: [...effects],
  };
}

function instanceOf(state: GameState, instanceId: InstanceId) {
  return state.cards[instanceId];
}

function resolve(harness: ReturnType<typeof createEffectHarness>, timing: 'on_play' | 'after_resolve' = 'on_play') {
  return resolveEffects({
    state: harness.state,
    snapshot: harness.snapshot,
    definitions: harness.definitions,
    bindings: harness.bindings,
    timing,
    enhancementSkills: [],
  });
}

describe('结算顺序', () => {
  it('按快照从左到右结算，事件顺序与出战顺序一致', () => {
    const effect: EffectConfig = {
      effectId: 'mark',
      timing: 'on_play',
      condition: { type: 'always' },
      operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 1 }],
    };
    const harness = createEffectHarness({
      cards: [characterWith('a', [effect]), characterWith('b', [effect]), characterWith('c', [effect])],
      slots: [0, 1, 2],
    });
    const result = resolve(harness);
    const resolved = result.events.filter((event) => event.type === 'EffectResolved');
    expect(resolved.map((event) => event.sourceInstanceId)).toEqual([
      harness.idAt(0),
      harness.idAt(1),
      harness.idAt(2),
    ]);
  });

  it('同一张卡内按 effects 书写顺序结算', () => {
    const harness = createEffectHarness({
      cards: [
        characterWith('a', [
          {
            effectId: 'first',
            timing: 'on_play',
            condition: { type: 'always' },
            operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 1 }],
          },
          {
            effectId: 'second',
            timing: 'on_play',
            condition: { type: 'always' },
            operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 2 }],
          },
        ]),
      ],
      slots: [0],
    });
    const result = resolve(harness);
    const resolved = result.events.filter((event) => event.type === 'EffectResolved');
    expect(resolved.map((event) => event.effectId)).toEqual(['first', 'second']);
  });

  it('同一效果内按 operations 书写顺序结算，顺序颠倒会失败', () => {
    const cards = (operations: EffectConfig['operations']) =>
      createEffectHarness({
        cards: [
          characterWith('a', [
            { effectId: 'order', timing: 'on_play', condition: { type: 'always' }, operations },
          ]),
        ],
        slots: [0],
        gold: 0,
      });

    const gainThenSpend = cards([
      { type: 'gain_gold', value: 2 },
      { type: 'consume_resource', resource: 'gold', amount: 1 },
    ]);
    const good = resolve(gainThenSpend);
    expect(good.rejections).toHaveLength(0);
    expect(good.state.run.gold).toBe(1);

    const spendThenGain = cards([
      { type: 'consume_resource', resource: 'gold', amount: 1 },
      { type: 'gain_gold', value: 2 },
    ]);
    const bad = resolve(spendThenGain);
    expect(bad.rejections).toHaveLength(1);
    expect(bad.state.run.gold).toBe(0);
  });

  it('时机不匹配的效果不参与本轮结算', () => {
    const harness = createEffectHarness({
      cards: [
        characterWith('a', [
          {
            effectId: 'later',
            timing: 'after_resolve',
            condition: { type: 'always' },
            operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 99 }],
          },
        ]),
      ],
      slots: [0],
    });
    const onPlay = resolve(harness, 'on_play');
    expect(onPlay.events.filter((event) => event.type === 'EffectResolved')).toHaveLength(0);

    const afterResolve = resolve(harness, 'after_resolve');
    const instance = instanceOf(afterResolve.state, harness.idAt(0));
    expect(instance?.thisPlayPower).toBe(99);
  });
});

describe('条件判定', () => {
  it('条件不满足时整条效果不触发', () => {
    const harness = createEffectHarness({
      cards: [
        characterWith('a', [
          {
            effectId: 'need_main_weapon',
            timing: 'on_play',
            condition: { type: 'self_equipped_weapon_relation', relation: 'main' },
            operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 30 }],
          },
        ]),
      ],
      slots: [0],
    });
    expect(harness.bindings).toHaveLength(0);
    const result = resolve(harness);
    expect(result.events.filter((event) => event.type === 'EffectResolved')).toHaveLength(0);
    expect(instanceOf(result.state, harness.idAt(0))?.thisPlayPower).toBe(0);
  });

  it('条件满足时触发，且快照中的状态参与判定', () => {
    const harness = createEffectHarness({
      cards: [
        characterWith('a', [
          {
            effectId: 'after_discard',
            timing: 'on_play',
            condition: { type: 'discarded_this_battle', min: 1 },
            operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 15 }],
          },
        ]),
      ],
      slots: [0],
      hasDiscardedThisBattle: true,
    });
    const result = resolve(harness);
    expect(instanceOf(result.state, harness.idAt(0))?.thisPlayPower).toBe(15);
  });
});

describe('一次性约束', () => {
  it('同一实体同一技能在一次出战中只触发一次', () => {
    const effect: EffectConfig = {
      effectId: 'once',
      timing: 'on_play',
      condition: { type: 'always' },
      operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 10 }],
    };
    const harness = createEffectHarness({ cards: [characterWith('a', [effect])], slots: [0] });
    const ctx = contextFrom(harness);
    const first = applyEffect(ctx, effect);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyEffect(first.value, effect);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(instanceOf(second.value.state, harness.idAt(0))?.thisPlayPower).toBe(10);
  });

  it('repeat_effect 是配置写明的例外，可以重复触发', () => {
    const harness = createEffectHarness({
      cards: [
        characterWith('a', [
          {
            effectId: 'gain',
            timing: 'on_play',
            condition: { type: 'always' },
            operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 5 }],
          },
          {
            effectId: 'triple',
            timing: 'on_play',
            condition: { type: 'always' },
            operations: [{ type: 'repeat_effect', effectId: 'gain', times: 3 }],
          },
        ]),
      ],
      slots: [0],
    });
    const result = resolve(harness);
    expect(result.rejections).toHaveLength(0);
    // gain 自身一次 + triple 重复三次。
    expect(instanceOf(result.state, harness.idAt(0))?.thisPlayPower).toBe(20);
  });
});

describe('嵌套约束', () => {
  it('自引用被判定为自循环', () => {
    const harness = createEffectHarness({
      cards: [
        characterWith('a', [
          {
            effectId: 'loop',
            timing: 'on_play',
            condition: { type: 'always' },
            operations: [
              { type: 'add_power', target: 'self', scope: 'this_play', value: 1 },
              { type: 'repeat_effect', effectId: 'loop', times: 1 },
            ],
          },
        ]),
      ],
      slots: [0],
    });
    const result = resolve(harness);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.code).toBe(AppErrorCode.EffectRejected);
    expect(result.state).toBe(harness.state);
  });

  it('超过嵌套深度上限时中止，且不做部分写入', () => {
    const effects: EffectConfig[] = [];
    const depth = MAX_EFFECT_DEPTH + 2;
    for (let index = 1; index <= depth; index += 1) {
      const next = index + 1;
      effects.push({
        effectId: `e${index}`,
        timing: 'on_play',
        condition: { type: 'always' },
        operations:
          next <= depth
            ? [{ type: 'repeat_effect', effectId: `e${next}`, times: 1 }]
            : [{ type: 'add_power', target: 'self', scope: 'this_play', value: 7 }],
      });
    }
    const harness = createEffectHarness({ cards: [characterWith('a', effects)], slots: [0] });
    const result = resolve(harness);
    expect(result.rejections.length).toBeGreaterThan(0);
    expect(instanceOf(result.state, harness.idAt(0))?.thisPlayPower).toBe(0);
  });
});

describe('失败回滚', () => {
  it('某个操作被拒时，该实体本轮引入的改动整体撤销', () => {
    const harness = createEffectHarness({
      cards: [
        characterWith('a', [
          {
            effectId: 'partial',
            timing: 'on_play',
            condition: { type: 'always' },
            operations: [
              { type: 'add_power', target: 'self', scope: 'this_play', value: 100 },
              { type: 'consume_resource', resource: 'gold', amount: 1 },
            ],
          },
        ]),
      ],
      slots: [0],
      gold: 0,
    });
    const result = resolve(harness);
    expect(result.rejections).toHaveLength(1);
    expect(instanceOf(result.state, harness.idAt(0))?.thisPlayPower).toBe(0);
    expect(result.state.run.gold).toBe(0);
  });

  it('一个实体失败不影响其余实体', () => {
    const failing = characterWith('a', [
      {
        effectId: 'boom',
        timing: 'on_play',
        condition: { type: 'always' },
        operations: [{ type: 'consume_resource', resource: 'gold', amount: 5 }],
      },
    ]);
    const fine = characterWith('b', [
      {
        effectId: 'ok',
        timing: 'on_play',
        condition: { type: 'always' },
        operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 8 }],
      },
    ]);
    const harness = createEffectHarness({ cards: [failing, fine], slots: [0, 1], gold: 1 });
    const result = resolve(harness);
    expect(result.rejections).toHaveLength(1);
    expect(instanceOf(result.state, harness.idAt(1))?.thisPlayPower).toBe(8);
  });
});

describe('注册表完整性', () => {
  it('每个已知操作类型都恰好有一个处理器', () => {
    expect(new Set(KNOWN_EFFECT_OPERATION_TYPES).size).toBe(KNOWN_EFFECT_OPERATION_TYPES.length);
  });

  it('未知操作类型在结算时报错而不是静默跳过', () => {
    const ctx = contextFrom(createEffectHarness({ cards: [characterWith('a', [])], slots: [0] }));
    const applied = applyEffect(ctx, {
      effectId: 'x',
      timing: 'on_play',
      condition: { type: 'always' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      operations: [{ type: 'not_a_real_operation' } as any],
    });
    expect(isErr(applied)).toBe(true);
  });
});
