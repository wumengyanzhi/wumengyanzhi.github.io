import { describe, expect, it } from 'vitest';
import type { CardDefinitionConfig } from '@config/schemas/card.schema';
import { AppErrorCode } from '@shared/error-codes';
import {
  absorbableAmp,
  absorbablePower,
  addGold,
  addStatByScope,
  moveInstance,
  patchInstance,
  resolveTarget,
  spendGold,
} from '@domain/effects/effect-context';
import { MAX_PATCHED_INSTANCES } from '@domain/effects/effect-limits';
import { contextFrom, createEffectHarness } from '../../support/effect-fixture';

/**
 * 效果上下文：读取口径、写入口与目标解析。
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

describe('数值四层与吸收口径', () => {
  it('基础与本局永久可被吸收，本场临时与本次加成不可', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const id = harness.idAt(0);
    const layered = addStatByScope(
      addStatByScope(addStatByScope(harness.cardAt(0), 'permanent', 7, 0), 'this_battle', 50, 0),
      'this_play',
      100,
      0,
    );
    const ctx = contextFrom(harness);
    const patched = patchInstance(ctx, id, () => layered);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    // 10 基础 + 7 永久；50 本场与 100 本次都不参与吸收。
    expect(absorbablePower(patched.value, id)).toBe(17);
  });

  it('人物没有基础增幅，武器按定义提供基础增幅', () => {
    const harness = createEffectHarness({ cards: [character, weapon], slots: [0, 1] });
    const ctx = contextFrom(harness);
    expect(absorbableAmp(ctx, harness.idAt(0))).toBe(0);
    expect(absorbableAmp(ctx, harness.idAt(1))).toBe(3);
  });

  it('按作用域写入对应数值层', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const base = harness.cardAt(0);
    expect(addStatByScope(base, 'this_play', 1, 2).thisPlayPower).toBe(1);
    expect(addStatByScope(base, 'this_battle', 3, 4).battleTemporaryAmp).toBe(4);
    expect(addStatByScope(base, 'permanent', 5, 6).permanentPower).toBe(5);
  });
});

describe('写入口', () => {
  it('目标不存在时返回结构化错误而不是静默跳过', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    const ctx = contextFrom(harness);
    const result = patchInstance(ctx, 'card-999' as never, (instance) => instance);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(AppErrorCode.EffectRejected);
  });

  it('单次结算写入的实体数量达到上限后拒绝继续写入', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0] });
    let ctx = contextFrom(harness);
    for (let round = 0; round < MAX_PATCHED_INSTANCES; round += 1) {
      const result = patchInstance(ctx, harness.idAt(0), (instance) => ({
        ...instance,
        permanentPower: instance.permanentPower + 1,
      }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      ctx = result.value;
    }
    const overflow = patchInstance(ctx, harness.idAt(0), (instance) => instance);
    expect(overflow.ok).toBe(false);
  });

  it('资源不足时拒绝支付，金币不变', () => {
    const harness = createEffectHarness({ cards: [character], slots: [0], gold: 2 });
    const ctx = contextFrom(harness);
    expect(spendGold(ctx, 5).ok).toBe(false);
    const spent = spendGold(ctx, 2);
    expect(spent.ok).toBe(true);
    if (!spent.ok) return;
    expect(spent.value.state.run.gold).toBe(0);
    expect(addGold(ctx, 3).state.run.gold).toBe(5);
  });

  it('移动卡牌会更新实例的牌区归属', () => {
    const harness = createEffectHarness({ cards: [character, weapon], slots: [0, 1] });
    const ctx = contextFrom(harness);
    const moved = moveInstance(ctx, harness.idAt(0), 'discardPile');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.state.cards[harness.idAt(0)]?.zone).toBe('discardPile');
    expect(moved.value.state.zones.discardPile).toContain(harness.idAt(0));
  });
});

describe('目标解析', () => {
  it('self 指向发起者，zone 指向本次出战整体', () => {
    const harness = createEffectHarness({ cards: [character, tactic], slots: [0, 1] });
    const ctx = contextFrom(harness, { sourceIndex: 1 });
    expect(resolveTarget(ctx, 'self')).toEqual({ kind: 'instance', instanceId: harness.idAt(1) });
    expect(resolveTarget(ctx, 'zone')).toEqual({ kind: 'zone', instanceId: null });
  });

  it('相邻以快照为准，离场不会让两侧重新连接', () => {
    // 中间留空位：索引 0 与 2 之间隔着空位，互不相邻。
    const harness = createEffectHarness({
      cards: [character, weapon, character],
      slots: [0, null, 2],
    });
    const ctx = contextFrom(harness, { sourceIndex: 0 });
    expect(resolveTarget(ctx, 'right_neighbour')).toBeNull();
    expect(resolveTarget(ctx, 'left_neighbour')).toBeNull();
  });

  it('装备目标优先取绑定关系，未绑定时回退实例上的装备记录', () => {
    const bound = createEffectHarness({
      cards: [character, weapon],
      slots: [0, 1],
      bindings: [],
    });
    // 绑定里的 ID 由夹具生成，这里替换成真实实例 ID。
    const withRealBinding = {
      ...bound,
      bindings: [
        {
          weaponInstanceId: bound.idAt(1),
          targetInstanceId: bound.idAt(0),
          relation: 'main' as const,
          ampBonus: 4,
        },
      ],
    };
    const ctx = contextFrom(withRealBinding, { sourceIndex: 1 });
    expect(resolveTarget(ctx, 'equipped_character')).toEqual({
      kind: 'instance',
      instanceId: bound.idAt(0),
    });
  });
});
