import { describe, expect, it } from 'vitest';
import type { CardDefinitionConfig } from '@config/schemas/card.schema';
import type { EffectConfig } from '@config/schemas/effect.schema';
import { AppErrorCode } from '@shared/error-codes';
import { isErr } from '@shared/result';
import { absorbablePower, readInstance } from '@domain/effects/effect-context';
import { MAX_EFFECT_DEPTH } from '@domain/effects/effect-limits';
import {
  addAmpHandler,
  addPermanentCardStatHandler,
  addPowerHandler,
  addTemporaryStatHandler,
  applyStatusHandler,
  changeEffectiveValueHandler,
  consumeResourceHandler,
  drawCardsHandler,
  gainGoldHandler,
  inspectAndReorderDeckHandler,
  moveCardHandler,
  repeatEffectHandler,
} from '@domain/effects/handlers/index';
import { contextFrom, createEffectHarness } from '../../support/effect-fixture';

/**
 * 效果处理器：每个处理器一组独立测试，覆盖正常目标、非法目标与参数边界。
 */

const character: CardDefinitionConfig = {
  id: 'test.character.a',
  name: '测试人物',
  cardType: 'character',
  rarity: 'rare',
  faction: 'shu',
  profession: 'warrior',
  basePower: 10,
  effects: [],
};

const commonCharacter: CardDefinitionConfig = {
  ...character,
  id: 'test.character.common',
  name: '普通人物',
  rarity: 'common',
};

const weapon: CardDefinitionConfig = {
  id: 'test.weapon.a',
  name: '测试武器',
  cardType: 'weapon',
  rarity: 'rare',
  weaponClass: 'blade',
  basePower: 5,
  baseAmp: 3,
  effects: [],
};

const tactic: CardDefinitionConfig = {
  id: 'test.tactic.a',
  name: '测试战术',
  cardType: 'tactic',
  rarity: 'rare',
  tacticDirection: 'power',
  basePower: 0,
  baseAmp: 2,
  effects: [],
};

describe('add_power', () => {
  it('写入自身的本次加成', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const ctx = contextFrom(harness);
    const result = addPowerHandler.apply(ctx, {
      type: 'add_power',
      target: 'self',
      scope: 'this_play',
      value: 7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readInstance(result.value, harness.idAt(0))?.thisPlayPower).toBe(7);
  });

  it('target 为 zone 时计入本次出战整体而不落到实体', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const ctx = contextFrom(harness);
    const result = addPowerHandler.apply(ctx, {
      type: 'add_power',
      target: 'zone',
      scope: 'this_play',
      value: 7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.zonePower).toBe(7);
    expect(readInstance(result.value, harness.idAt(0))?.thisPlayPower).toBe(0);
  });

  it('按某类卡数量缩放，并受 max 封顶', () => {
    const harness = createEffectHarness({ cards: [character, weapon, tactic], slots: [0, 1, 2] });
    const ctx = contextFrom(harness);
    // 出战中有 1 张战术：value 10 + 1×5 = 15。
    const under = addPowerHandler.apply(ctx, {
      type: 'add_power',
      target: 'self',
      scope: 'this_play',
      value: 10,
      scale: { countCardType: 'tactic', each: 5, max: 20 },
    });
    expect(under.ok && readInstance(under.value, harness.idAt(0))?.thisPlayPower).toBe(15);
    // 封顶：即使按 3 张算也只给 max。
    const capped = addPowerHandler.apply(ctx, {
      type: 'add_power',
      target: 'self',
      scope: 'this_play',
      value: 10,
      scale: { countCardType: 'tactic', each: 50, max: 20 },
    });
    expect(capped.ok && readInstance(capped.value, harness.idAt(0))?.thisPlayPower).toBe(30);
  });

  it('相邻目标不存在时返回结构化错误', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const ctx = contextFrom(harness);
    const result = addPowerHandler.apply(ctx, {
      type: 'add_power',
      target: 'right_neighbour',
      scope: 'this_play',
      value: 7,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(AppErrorCode.EffectRejected);
  });

  it('操作类型与处理器不匹配时被拒', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = addPowerHandler.apply(contextFrom(harness), {
      type: 'add_amp',
      target: 'self',
      scope: 'this_play',
      value: 7,
    });
    expect(result.ok).toBe(false);
  });
});

describe('add_amp', () => {
  it('写入增幅列，不影响威力', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = addAmpHandler.apply(contextFrom(harness), {
      type: 'add_amp',
      target: 'self',
      scope: 'this_play',
      value: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const instance = readInstance(result.value, harness.idAt(0));
    expect(instance?.thisPlayAmp).toBe(4);
    expect(instance?.thisPlayPower).toBe(0);
  });
});

describe('资源增减', () => {
  it('gain_gold 增加金币并产生事件', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0], gold: 2 });
    const result = gainGoldHandler.apply(contextFrom(harness), { type: 'gain_gold', value: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.run.gold).toBe(5);
    expect(result.value.events).toContainEqual({ type: 'GoldGained', amount: 3 });
  });

  it('consume_resource 扣除金币，不足时拒绝且金币不变', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0], gold: 2 });
    const ctx = contextFrom(harness);
    const tooMuch = consumeResourceHandler.apply(ctx, { type: 'consume_resource', resource: 'gold', amount: 5 });
    expect(tooMuch.ok).toBe(false);
    const ok = consumeResourceHandler.apply(ctx, { type: 'consume_resource', resource: 'gold', amount: 2 });
    expect(ok.ok && ok.value.state.run.gold).toBe(0);
  });
});

describe('draw_cards', () => {
  it('从抽牌堆抽牌并更新实例牌区', () => {
    const harness = createEffectHarness({ cards: [character, weapon, tactic], slots: [0] });
    const withPile = {
      ...harness,
      state: { ...harness.state, zones: { ...harness.state.zones, drawPile: [harness.idAt(1), harness.idAt(2)] } },
    };
    const result = drawCardsHandler.apply(contextFrom(withPile), { type: 'draw_cards', count: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.zones.hand).toContain(harness.idAt(1));
    expect(readInstance(result.value, harness.idAt(1))?.zone).toBe('hand');
  });

  it('没有随机端口时拒绝，不静默补牌', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = drawCardsHandler.apply(contextFrom(harness, { rng: null }), {
      type: 'draw_cards',
      count: 1,
    });
    expect(result.ok).toBe(false);
  });

  it('抽牌数量不是正整数时被拒', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = drawCardsHandler.apply(contextFrom(harness), { type: 'draw_cards', count: 0 });
    expect(result.ok).toBe(false);
  });
});

describe('move_card', () => {
  it('把目标移入弃牌堆', () => {
    const harness = createEffectHarness({ cards: [character, weapon], slots: [0, 1] });
    const result = moveCardHandler.apply(contextFrom(harness, { sourceIndex: 1 }), {
      type: 'move_card',
      target: 'self',
      to: 'discardPile',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readInstance(result.value, harness.idAt(1))?.zone).toBe('discardPile');
    expect(result.value.state.zones.playSlots[1]).toBeNull();
  });

  it('目标不存在时被拒', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = moveCardHandler.apply(contextFrom(harness), {
      type: 'move_card',
      target: 'right_neighbour',
      to: 'discardPile',
    });
    expect(result.ok).toBe(false);
  });
});

describe('add_temporary_stat', () => {
  it('写入本场临时层，不进入永久层', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = addTemporaryStatHandler.apply(contextFrom(harness), {
      type: 'add_temporary_stat',
      target: 'self',
      power: 6,
      amp: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const instance = readInstance(result.value, harness.idAt(0));
    expect(instance?.battleTemporaryPower).toBe(6);
    expect(instance?.battleTemporaryAmp).toBe(2);
    expect(instance?.permanentPower).toBe(0);
  });
});

describe('add_permanent_card_stat', () => {
  it('稀有及以上可以发起本局永久强化', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = addPermanentCardStatHandler.apply(contextFrom(harness), {
      type: 'add_permanent_card_stat',
      target: 'self',
      power: 8,
      amp: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readInstance(result.value, harness.idAt(0))?.permanentPower).toBe(8);
  });

  it('普通卡发起永久强化被稀有度权限拦下', () => {
    const harness = createEffectHarness({ cards: [commonCharacter], slots: [0] });
    const result = addPermanentCardStatHandler.apply(contextFrom(harness), {
      type: 'add_permanent_card_stat',
      target: 'self',
      power: 8,
      amp: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(AppErrorCode.EffectRejected);
    expect(result.error.details?.rarity).toBe('common');
  });

  it('永久强化必须指定具体卡牌', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = addPermanentCardStatHandler.apply(contextFrom(harness), {
      type: 'add_permanent_card_stat',
      target: 'zone',
      power: 8,
      amp: 0,
    });
    expect(result.ok).toBe(false);
  });
});

describe('apply_status', () => {
  it('同名状态叠加层数，剩余次数取较大值', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const ctx = contextFrom(harness);
    const first = applyStatusHandler.apply(ctx, {
      type: 'apply_status',
      target: 'self',
      statusId: 'poison',
      stacks: 2,
      remainingUses: 3,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyStatusHandler.apply(first.value, {
      type: 'apply_status',
      target: 'self',
      statusId: 'poison',
      stacks: 1,
      remainingUses: 1,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const statuses = readInstance(second.value, harness.idAt(0))?.statuses ?? [];
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.stacks).toBe(3);
    expect(statuses[0]?.remainingUses).toBe(3);
  });

  it('无次数限制叠加后仍无次数限制', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const ctx = contextFrom(harness);
    const first = applyStatusHandler.apply(ctx, {
      type: 'apply_status',
      target: 'self',
      statusId: 'mark',
      stacks: 1,
      remainingUses: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyStatusHandler.apply(first.value, {
      type: 'apply_status',
      target: 'self',
      statusId: 'mark',
      stacks: 1,
      remainingUses: 5,
    });
    expect(second.ok && readInstance(second.value, harness.idAt(0))?.statuses[0]?.remainingUses).toBeNull();
  });
});

describe('inspect_and_reorder_deck', () => {
  it('整段搬到顶部时顺序不变', () => {
    const harness = createEffectHarness({ cards: [character, weapon, tactic], slots: [0] });
    const withPile = {
      ...harness,
      state: {
        ...harness.state,
        zones: { ...harness.state.zones, drawPile: [harness.idAt(1), harness.idAt(2)] },
      },
    };
    const result = inspectAndReorderDeckHandler.apply(contextFrom(withPile), {
      type: 'inspect_and_reorder_deck',
      count: 2,
      to: 'top',
    });
    expect(result.ok && result.value.state.zones.drawPile).toEqual([harness.idAt(1), harness.idAt(2)]);
  });

  it('搬到底部时其余卡相对前移', () => {
    const harness = createEffectHarness({ cards: [character, weapon, tactic], slots: [0] });
    const withPile = {
      ...harness,
      state: {
        ...harness.state,
        zones: { ...harness.state.zones, drawPile: [harness.idAt(1), harness.idAt(2)] },
      },
    };
    const result = inspectAndReorderDeckHandler.apply(contextFrom(withPile), {
      type: 'inspect_and_reorder_deck',
      count: 1,
      to: 'bottom',
    });
    expect(result.ok && result.value.state.zones.drawPile).toEqual([harness.idAt(2), harness.idAt(1)]);
  });

  it('抽牌堆不足时按实际张数处理且不报错', () => {
    const harness = createEffectHarness({ cards: [character, weapon], slots: [0] });
    const withPile = {
      ...harness,
      state: { ...harness.state, zones: { ...harness.state.zones, drawPile: [harness.idAt(1)] } },
    };
    const result = inspectAndReorderDeckHandler.apply(contextFrom(withPile), {
      type: 'inspect_and_reorder_deck',
      count: 5,
      to: 'bottom',
    });
    expect(result.ok && result.value.state.zones.drawPile).toEqual([harness.idAt(1)]);
  });
});

describe('change_effective_value', () => {
  it('只吸收基础与本局永久，本场临时与本次加成不被吸收', () => {
    const harness = createEffectHarness({ cards: [character, weapon], slots: [0, 1] });
    const source = harness.idAt(1);
    const target = harness.idAt(0);
    // 目标：基础 10 + 永久 7；另有本场 50 与本次 100 不应被吸收。
    const layered = {
      ...harness.state.cards,
      [target]: {
        ...(harness.state.cards[target] as NonNullable<ReturnType<typeof readInstance>>),
        permanentPower: 7,
        battleTemporaryPower: 50,
        thisPlayPower: 100,
      },
    };
    const withLayered = { ...harness, state: { ...harness.state, cards: layered } };
    const prepared = contextFrom(withLayered, { sourceIndex: 1 });
    const result = changeEffectiveValueHandler.apply(prepared, {
      type: 'change_effective_value',
      mode: 'absorb_power',
      from: 'left_neighbour',
      scope: 'this_play',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(absorbablePower(result.value, target)).toBe(17);
    expect(readInstance(result.value, source)?.thisPlayPower).toBe(17);
  });

  it('不得吸收自身', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = changeEffectiveValueHandler.apply(contextFrom(harness), {
      type: 'change_effective_value',
      mode: 'absorb_power',
      from: 'self',
      scope: 'this_play',
    });
    expect(result.ok).toBe(false);
  });

  it('吸收来源不存在时被拒', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const result = changeEffectiveValueHandler.apply(contextFrom(harness), {
      type: 'change_effective_value',
      mode: 'absorb_amp',
      from: 'right_neighbour',
      scope: 'this_play',
    });
    expect(result.ok).toBe(false);
  });
});

describe('repeat_effect', () => {
  const addPowerEffect: EffectConfig = {
    effectId: 'base',
    timing: 'on_play',
    condition: { type: 'always' },
    operations: [{ type: 'add_power', target: 'self', scope: 'this_play', value: 10 }],
  };

  const repeater: CardDefinitionConfig = {
    ...character,
    effects: [
      addPowerEffect,
      {
        effectId: 'repeat',
        timing: 'on_play',
        condition: { type: 'always' },
        operations: [{ type: 'repeat_effect', effectId: 'base', times: 2 }],
      },
    ],
  };

  const selfLoop: CardDefinitionConfig = {
    ...character,
    effects: [
      {
        effectId: 'loop',
        timing: 'on_play',
        condition: { type: 'always' },
        operations: [{ type: 'repeat_effect', effectId: 'loop', times: 1 }],
      },
    ],
  };

  it('按次数重复同一张卡上的另一个效果', () => {
    const harness = createEffectHarness({ cards: [repeater], slots: [0] });
    const ctx = contextFrom(harness, { effectId: 'repeat' });
    const result = repeatEffectHandler.apply(ctx, {
      type: 'repeat_effect',
      effectId: 'base',
      times: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readInstance(result.value, harness.idAt(0))?.thisPlayPower).toBe(20);
  });

  it('自引用在同一次结算中被判为循环并整条拒绝', () => {
    const harness = createEffectHarness({ cards: [selfLoop], slots: [0] });
    const ctx = contextFrom(harness, { effectId: 'loop' });
    const result = repeatEffectHandler.apply(ctx, {
      type: 'repeat_effect',
      effectId: 'loop',
      times: 1,
    });
    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.code).toBe(AppErrorCode.EffectRejected);
    expect(result.error.message).toContain('自循环');
  });

  it('嵌套深度达到上限时安全中止', () => {
    const harness = createEffectHarness({ cards: [repeater], slots: [0] });
    const ctx = contextFrom(harness, { effectId: 'repeat' });
    const deep = { ...ctx, depth: MAX_EFFECT_DEPTH };
    const result = repeatEffectHandler.apply(deep, {
      type: 'repeat_effect',
      effectId: 'base',
      times: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('嵌套');
  });

  it('重复次数越界时被拒', () => {
    const harness = createEffectHarness({ cards: [repeater], slots: [0] });
    const result = repeatEffectHandler.apply(contextFrom(harness, { effectId: 'repeat' }), {
      type: 'repeat_effect',
      effectId: 'base',
      times: 0,
    });
    expect(result.ok).toBe(false);
  });

  it('不能重复不在同一张卡上的效果', () => {
    const harness = createEffectHarness({ cards: [repeater], slots: [0] });
    const result = repeatEffectHandler.apply(contextFrom(harness, { effectId: 'repeat' }), {
      type: 'repeat_effect',
      effectId: 'someone_elses_effect',
      times: 1,
    });
    expect(result.ok).toBe(false);
  });

  it('没有递归入口时拒绝，等同于禁止结算期间开启新出战', () => {
    const harness = createEffectHarness({ cards: [repeater], slots: [0] });
    const ctx = { ...contextFrom(harness, { effectId: 'repeat' }), resolveEffect: null };
    const result = repeatEffectHandler.apply(ctx, {
      type: 'repeat_effect',
      effectId: 'base',
      times: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('不得开启新的出战');
  });
});
