import { describe, expect, it } from 'vitest';
import { asDefinitionId, type DefinitionId } from '@domain/models/ids';
import { playCards } from '@domain/commands/play-cards';
import { discardCards } from '@domain/commands/discard-cards';
import type { GameState } from '@domain/state/game-state';
import {
  createPreparedState,
  definitions,
  effectiveConfig,
  instanceIdOfDefinition,
  rules,
  rng,
  setHand,
  startBattleWith,
} from '../../support/domain-fixture';

/**
 * 技能效果在真实卡池中的端到端验证。
 *
 * 不替换配置，直接用 06 第七节冻结的 20 张卡跑出战，确认卡面写的效果真的进了结算。
 * 伤害按现行公式手算：威力总值 × 增幅总值，区域基础 0 威力 / 1 增幅，
 * 军势档位为「成军」（12 张人物），每点军势 +5 威力，每 5 点 +1 增幅。
 */

const C = {
  mengShi: asDefinitionId('three_kingdoms.character.shu_zhong_meng_shi'),
  gongShou: asDefinitionId('three_kingdoms.character.jiang_dong_gong_shou'),
  xiaoJiang: asDefinitionId('three_kingdoms.character.shu_zhong_xiao_jiang'),
  huWei: asDefinitionId('three_kingdoms.character.hu_wei_su_jiang'),
  zhiJiang: asDefinitionId('three_kingdoms.character.jiang_dong_zhi_jiang'),
  shenShe: asDefinitionId('three_kingdoms.character.sai_wai_shen_she'),
  blade: asDefinitionId('three_kingdoms.weapon.huan_shou_dao'),
  leiGu: asDefinitionId('three_kingdoms.tactic.lei_gu_jin_jun'),
  ceYing: asDefinitionId('three_kingdoms.tactic.zuo_you_ce_ying'),
  junLiang: asDefinitionId('three_kingdoms.tactic.chou_cuo_jun_liang'),
} as const;

function battleWithHand(hand: readonly DefinitionId[]): GameState {
  return setHand(startBattleWith(createPreparedState()), hand);
}

function play(state: GameState, definitionIds: readonly DefinitionId[]) {
  return playCards({
    state,
    rules,
    rng,
    definitions,
    enhancementSkills: effectiveConfig.enhancement.legendarySkillPool,
    assignments: definitionIds.map((definitionId, slotIndex) => ({
      slotIndex,
      instanceId: instanceIdOfDefinition(state, definitionId),
    })),
  });
}

function effectIdsOf(outcome: { events: readonly { type: string; effectId?: string }[] }): string[] {
  return outcome.events
    .filter((event): event is { type: 'EffectResolved'; effectId: string } => event.type === 'EffectResolved')
    .map((event) => event.effectId);
}

function damageOf(outcome: { events: readonly { type: string; amount?: number }[] }): number {
  const event = outcome.events.find(
    (candidate): candidate is { type: 'DamageResolved'; amount: number } => candidate.type === 'DamageResolved',
  );
  return event?.amount ?? -1;
}

describe('稀有人物技能', () => {
  it('蜀中骁将装备本职武器时本场威力 +15', () => {
    const state = battleWithHand([C.xiaoJiang, C.blade]);
    const outcome = play(state, [C.xiaoJiang, C.blade]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(effectIdsOf(outcome.value)).toContain('main_weapon_mastery');
    // 威力 0+30+10+15(技能)+5(军势 1 点) = 60；增幅 1+1(武器)+4(本职) = 6。
    expect(damageOf(outcome.value)).toBe(60 * 6);
  });

  it('蜀中骁将装备非本职武器时不触发', () => {
    const state = battleWithHand([C.xiaoJiang, C.gongShou, C.blade]);
    // 骁将放 0 号位、弓手放 2 号位、武器放 1 号位需要显式占位，这里用 0/1 相邻验证另一条路径：
    // 直接把武器放在弓手旁边，使骁将不成为装备目标。
    const outcome = playCards({
      state,
      rules,
      rng,
      definitions,
      assignments: [
        { slotIndex: 0, instanceId: instanceIdOfDefinition(state, C.xiaoJiang) },
        { slotIndex: 2, instanceId: instanceIdOfDefinition(state, C.gongShou) },
        { slotIndex: 3, instanceId: instanceIdOfDefinition(state, C.blade) },
      ],
      targets: { [instanceIdOfDefinition(state, C.blade)]: instanceIdOfDefinition(state, C.gongShou) },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(effectIdsOf(outcome.value)).not.toContain('main_weapon_mastery');
  });

  it('虎卫宿将两侧均为人物时本场威力 +20', () => {
    const state = battleWithHand([C.mengShi, C.huWei, C.gongShou]);
    const outcome = play(state, [C.mengShi, C.huWei, C.gongShou]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(effectIdsOf(outcome.value)).toContain('center_guard');
  });

  it('虎卫宿将一侧不是人物时不触发', () => {
    const state = battleWithHand([C.huWei, C.gongShou]);
    const outcome = play(state, [C.huWei, C.gongShou]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(effectIdsOf(outcome.value)).not.toContain('center_guard');
  });

  it('江东智将在本场出战含战术时本场威力 +15', () => {
    const state = battleWithHand([C.zhiJiang, C.leiGu]);
    const outcome = play(state, [C.zhiJiang, C.leiGu]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(effectIdsOf(outcome.value)).toContain('coordinated_plan');
  });

  it('塞外神射在本场已弃牌后本场威力 +15', () => {
    const prepared = battleWithHand([C.shenShe, C.mengShi, C.gongShou]);
    const discarded = discardCards({
      state: prepared,
      rules,
      rng,
      instanceIds: [instanceIdOfDefinition(prepared, C.mengShi)],
    });
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.value.state.battle?.hasDiscardedThisBattle).toBe(true);

    const outcome = play(discarded.value.state, [C.shenShe]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(effectIdsOf(outcome.value)).toContain('waiting_volley');
  });
});

describe('稀有战术技能', () => {
  it('擂鼓进军按出战人物数量给整体加威力，单人时 +5', () => {
    const state = battleWithHand([C.mengShi, C.leiGu]);
    const outcome = play(state, [C.mengShi, C.leiGu]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(effectIdsOf(outcome.value)).toContain('outnumber');
    // 威力 0+20(猛士)+20(战术)+5(技能)+5(军势) = 50；增幅 1+0 = 1。
    expect(damageOf(outcome.value)).toBe(50);
  });

  it('左右策应两侧均为人物时整体增幅 +2', () => {
    const state = battleWithHand([C.mengShi, C.ceYing, C.gongShou]);
    const outcome = play(state, [C.mengShi, C.ceYing, C.gongShou]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(effectIdsOf(outcome.value)).toContain('flank_support');
    // 威力 0+20(猛士)+0(战术)+20(弓手)+10(军势 2 点，只有人物涨军势) = 50；
    // 增幅 1(区域)+4(战术)+2(技能) = 7。
    expect(damageOf(outcome.value)).toBe(50 * 7);
  });

  it('筹措军粮在三种卡类型同场时结算后给 1 金币', () => {
    const state = battleWithHand([C.mengShi, C.blade, C.junLiang]);
    expect(state.run.gold).toBe(effectiveConfig.economy.initialGold);
    const outcome = play(state, [C.mengShi, C.blade, C.junLiang]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(effectIdsOf(outcome.value)).toContain('supply_prepare');
    expect(outcome.value.state.run.gold).toBe(effectiveConfig.economy.initialGold + 1);
  });

  it('筹措军粮在卡类型不足三种时不给金币', () => {
    const state = battleWithHand([C.mengShi, C.junLiang]);
    const outcome = play(state, [C.mengShi, C.junLiang]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(effectIdsOf(outcome.value)).not.toContain('supply_prepare');
    expect(outcome.value.state.run.gold).toBe(effectiveConfig.economy.initialGold);
  });
});

describe('技能与战斗流程的边界', () => {
  it('技能只影响本次出战，离场后本次加成被清除', () => {
    const state = battleWithHand([C.xiaoJiang, C.blade, C.mengShi, C.gongShou]);
    const outcome = play(state, [C.xiaoJiang, C.blade]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const xiaoJiang = outcome.value.state.cards[instanceIdOfDefinition(state, C.xiaoJiang)];
    expect(xiaoJiang?.thisPlayPower).toBe(0);
    expect(xiaoJiang?.morale).toBe(1);
  });
});
