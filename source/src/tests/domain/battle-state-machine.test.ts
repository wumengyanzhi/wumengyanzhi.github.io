import { describe, expect, it } from 'vitest';
import { AppErrorCode } from '@shared/error-codes';
import type { DefinitionId } from '@domain/models/ids';
import { asDefinitionId } from '@domain/models/ids';
import { playCards } from '@domain/commands/play-cards';
import { discardCards } from '@domain/commands/discard-cards';
import { stageCard, unstageCard } from '@domain/commands/stage-card';
import { findWeaponsNeedingTarget, selectWeaponTarget } from '@domain/commands/select-target';
import { calculateDamage } from '@domain/systems/damage-calculator';
import { resolveEquipments, resolveMoraleTier } from '@domain/systems/weapon-matching';
import { drawCards } from '@domain/systems/zone-transfers';
import { addEnhancementSkill, withZone } from '@domain/models/card-instance';
import type { BattleEvent } from '@domain/events/battle-events';
import type { GameState } from '@domain/state/game-state';
import {
  HUANG_JIN_ID,
  HU_LAO_ID,
  definitions,
  effectiveConfig,
  instanceIdOfDefinition,
  rng,
  rules,
  setHand,
  startBattleWith,
  createPreparedState,
} from '../support/domain-fixture';

const MENG_SHI = asDefinitionId('three_kingdoms.character.shu_zhong_meng_shi');
const JIAN_KE = asDefinitionId('three_kingdoms.character.qun_xiong_jian_ke');
const CE_SHI = asDefinitionId('three_kingdoms.character.wei_ying_ce_shi');
const GONG_SHOU = asDefinitionId('three_kingdoms.character.shu_zhong_gong_shou');
const HUAN_SHOU_DAO = asDefinitionId('three_kingdoms.weapon.huan_shou_dao');
const LEI_GU = asDefinitionId('three_kingdoms.tactic.lei_gu_jin_jun');
const SHU_ZHONG_XIAO_JIANG = asDefinitionId('three_kingdoms.character.shu_zhong_xiao_jiang');
const HU_WEI_SU_JIANG = asDefinitionId('three_kingdoms.character.hu_wei_su_jiang');
const JIANG_DONG_ZHI_JIANG = asDefinitionId('three_kingdoms.character.jiang_dong_zhi_jiang');
const SAI_WAI_SHEN_SHE = asDefinitionId('three_kingdoms.character.sai_wai_shen_she');
const ZUO_YOU_CE_YING = asDefinitionId('three_kingdoms.tactic.zuo_you_ce_ying');
const CHOU_CUO_JUN_LIANG = asDefinitionId('three_kingdoms.tactic.chou_cuo_jun_liang');

function playOnce(
  state: GameState,
  slots: readonly (DefinitionId | null)[],
  targets?: Readonly<Record<string, string>>,
): { state: GameState; events: readonly BattleEvent[] } {
  const assignments = slots
    .map((definitionId, slotIndex) => ({ definitionId, slotIndex }))
    .filter((entry): entry is { definitionId: DefinitionId; slotIndex: number } => entry.definitionId !== null)
    .map((entry) => ({ slotIndex: entry.slotIndex, instanceId: instanceIdOfDefinition(state, entry.definitionId) }));

  const result = playCards({
    state,
    rules,
    rng,
    definitions,
    enhancementSkills: effectiveConfig.enhancement.legendarySkillPool,
    assignments,
    ...(targets === undefined ? {} : { targets: targets as Readonly<Record<string, never>> }),
  });
  if (!result.ok) {
    throw new Error(`出战被拒绝：${result.error.code} ${result.error.message}`);
  }
  return result.value;
}

function damageOf(events: readonly BattleEvent[]): number {
  const event = events.find((entry) => entry.type === 'DamageResolved');
  if (event === undefined || event.type !== 'DamageResolved') {
    throw new Error('没有产生伤害事件');
  }
  return event.amount;
}

describe('战斗开始', () => {
  it('按配置建立资源、手牌与军势档位', () => {
    const state = startBattleWith(createPreparedState());
    expect(state.battle?.playCountRemaining).toBe(4);
    expect(state.battle?.discardCountRemaining).toBe(3);
    expect(state.battle?.enemyCurrentHp).toBe(1200);
    expect(state.battle?.moraleTier).toBe('formed');
    expect(state.battle?.status).toBe('in_progress');
    expect(state.zones.hand).toHaveLength(8);
    expect(state.zones.playSlots).toHaveLength(5);
    expect(state.zones.playSlots.every((slot) => slot === null)).toBe(true);
  });

  it('敌人生命与最大生命来自配置', () => {
    const state = startBattleWith(createPreparedState(), HU_LAO_ID);
    expect(state.battle?.enemyMaxHp).toBe(3600);
    expect(state.battle?.enemyCurrentHp).toBe(3600);
  });

  it('洗牌后提交 RNG 游标，并保持牌区索引与实例位置一致', () => {
    const state = startBattleWith(createPreparedState());
    expect(state.rng.cursor).toBe(19);

    for (const instanceId of state.zones.hand) {
      expect(state.cards[instanceId]?.zone).toBe('hand');
    }
    for (const instanceId of state.zones.drawPile) {
      expect(state.cards[instanceId]?.zone).toBe('drawPile');
    }
  });
});

describe('职业匹配与伤害公式', () => {
  it('本职：武者配刀，增幅区 1 + 1 + 4', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, HUAN_SHOU_DAO]);
    const { events } = playOnce(state, [MENG_SHI, HUAN_SHOU_DAO]);
    expect(damageOf(events)).toBe((20 + 10 + 5) * (1 + 1 + 4));
  });

  it('可用：暗客配刀，增幅区 1 + 1 + 2', () => {
    const state = setHand(startBattleWith(createPreparedState()), [JIAN_KE, HUAN_SHOU_DAO]);
    const { events } = playOnce(state, [JIAN_KE, HUAN_SHOU_DAO]);
    expect(damageOf(events)).toBe((20 + 10 + 5) * (1 + 1 + 2));
  });

  it('偏门：术士配刀，增幅区 1 + 1 + 1', () => {
    const state = setHand(startBattleWith(createPreparedState()), [CE_SHI, HUAN_SHOU_DAO]);
    const { events } = playOnce(state, [CE_SHI, HUAN_SHOU_DAO]);
    expect(damageOf(events)).toBe((20 + 10 + 5) * (1 + 1 + 1));
  });

  it('不匹配：射手配刀，增幅区 1 + 1 + 0', () => {
    const state = setHand(startBattleWith(createPreparedState()), [GONG_SHOU, HUAN_SHOU_DAO]);
    const { events } = playOnce(state, [GONG_SHOU, HUAN_SHOU_DAO]);
    expect(damageOf(events)).toBe((20 + 10 + 5) * (1 + 1 + 0));
  });

  it('战术按定义提供基础威力，并结算配置效果', () => {
    const state = setHand(startBattleWith(createPreparedState()), [LEI_GU, MENG_SHI]);
    const { events } = playOnce(state, [LEI_GU, MENG_SHI]);
    expect(damageOf(events)).toBe((20 + 20 + 5 + 5) * 1);
  });
});

describe('配置驱动卡牌效果', () => {
  it('蜀中骁将装备本职武器时获得本次威力', () => {
    const state = setHand(startBattleWith(createPreparedState()), [SHU_ZHONG_XIAO_JIANG, HUAN_SHOU_DAO]);
    const { events } = playOnce(state, [SHU_ZHONG_XIAO_JIANG, HUAN_SHOU_DAO]);
    expect(damageOf(events)).toBe((30 + 10 + 5 + 15) * (1 + 1 + 4));
  });

  it('人物与战术效果按从左到右共同写入本次威力区', () => {
    const state = setHand(startBattleWith(createPreparedState()), [JIANG_DONG_ZHI_JIANG, LEI_GU]);
    const { events } = playOnce(state, [JIANG_DONG_ZHI_JIANG, LEI_GU]);
    expect(damageOf(events)).toBe(75);
  });

  it('左右策应两侧都是人物时增加本次增幅区', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, ZUO_YOU_CE_YING, GONG_SHOU]);
    const { events } = playOnce(state, [MENG_SHI, ZUO_YOU_CE_YING, GONG_SHOU]);
    expect(damageOf(events)).toBe((20 + 20 + 10) * (1 + 4 + 2));
  });

  it('主动弃牌后塞外神射获得本次威力', () => {
    const started = startBattleWith(createPreparedState());
    const discarded = discardCards({ state: started, rules, rng, instanceIds: started.zones.hand.slice(0, 1) });
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    const state = setHand(discarded.value.state, [SAI_WAI_SHEN_SHE]);
    const { events } = playOnce(state, [SAI_WAI_SHEN_SHE]);
    expect(damageOf(events)).toBe(50);
  });

  it('筹措军粮满足三种卡牌类型时在结算后获得金币', () => {
    const state = setHand(
      startBattleWith(createPreparedState()),
      [MENG_SHI, CHOU_CUO_JUN_LIANG, HUAN_SHOU_DAO],
    );
    const { state: after } = playOnce(state, [MENG_SHI, CHOU_CUO_JUN_LIANG, null, null, HUAN_SHOU_DAO]);
    expect(after.run.gold).toBe(3);
  });

  it('虎卫宿将两侧都是人物时获得本次威力', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, HU_WEI_SU_JIANG, GONG_SHOU]);
    const { events } = playOnce(state, [MENG_SHI, HU_WEI_SU_JIANG, GONG_SHOU]);
    expect(damageOf(events)).toBe(100);
  });
});

describe('传说附加技能', () => {
  function giveSkill(state: GameState, definitionId: DefinitionId, suffix: string): GameState {
    const instanceId = instanceIdOfDefinition(state, definitionId);
    const instance = state.cards[instanceId];
    if (instance === undefined) throw new Error('强化目标不存在');
    return {
      ...state,
      cards: {
        ...state.cards,
        [instanceId]: addEnhancementSkill(instance, `three_kingdoms.enhancement_skill.${suffix}`),
      },
    };
  }

  it('先登与振军只在该卡本场第一次主动出战时生效', () => {
    const base = setHand(startBattleWith(createPreparedState()), [MENG_SHI]);
    const xianDeng = playOnce(giveSkill(base, MENG_SHI, 'xian_deng'), [MENG_SHI]);
    expect(damageOf(xianDeng.events)).toBe(50);
    const zhenJun = playOnce(giveSkill(base, MENG_SHI, 'zhen_jun'), [MENG_SHI]);
    expect(damageOf(zhenJun.events)).toBe(75);
  });

  it('同道按另一张同类型卡增加威力，孤锋按唯一类型增加增幅', () => {
    const base = setHand(startBattleWith(createPreparedState()), [MENG_SHI, GONG_SHOU, HUAN_SHOU_DAO]);
    const tongDao = playOnce(giveSkill(base, MENG_SHI, 'tong_dao'), [MENG_SHI, GONG_SHOU]);
    expect(damageOf(tongDao.events)).toBe(80);
    const guFeng = playOnce(giveSkill(base, MENG_SHI, 'gu_feng'), [MENG_SHI, null, HUAN_SHOU_DAO]);
    expect(damageOf(guFeng.events)).toBe(175);
  });

  it('军需结算后获得金币，回响只重复原有技能', () => {
    const goldBase = setHand(startBattleWith(createPreparedState()), [MENG_SHI]);
    const junXu = playOnce(giveSkill(goldBase, MENG_SHI, 'jun_xu'), [MENG_SHI]);
    expect(junXu.state.run.gold).toBe(3);
    const echoBase = setHand(startBattleWith(createPreparedState()), [LEI_GU, MENG_SHI]);
    const echo = playOnce(giveSkill(echoBase, LEI_GU, 'hui_xiang'), [LEI_GU, MENG_SHI]);
    expect(damageOf(echo.events)).toBe(55);
  });
});

describe('相邻与装备目标', () => {
  it('双侧均为人物时必须先选择装备目标', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, HUAN_SHOU_DAO, GONG_SHOU]);
    const assignments = [
      { slotIndex: 0, instanceId: instanceIdOfDefinition(state, MENG_SHI) },
      { slotIndex: 1, instanceId: instanceIdOfDefinition(state, HUAN_SHOU_DAO) },
      { slotIndex: 2, instanceId: instanceIdOfDefinition(state, GONG_SHOU) },
    ];
    const result = playCards({ state, rules, rng, definitions, assignments });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AppErrorCode.InvalidCommand);
      expect(result.error.message).toContain('必须先选择装备目标');
    }
  });

  it('指定目标后按该人物的职业匹配', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, HUAN_SHOU_DAO, GONG_SHOU]);
    const weaponId = instanceIdOfDefinition(state, HUAN_SHOU_DAO);
    const { events } = playOnce(state, [MENG_SHI, HUAN_SHOU_DAO, GONG_SHOU], {
      [weaponId]: instanceIdOfDefinition(state, MENG_SHI),
    });
    expect(damageOf(events)).toBe((20 + 20 + 10 + 10) * (1 + 1 + 4));
  });

  it('指定另一名人物时按该人物的职业匹配', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, HUAN_SHOU_DAO, GONG_SHOU]);
    const weaponId = instanceIdOfDefinition(state, HUAN_SHOU_DAO);
    const { events } = playOnce(state, [MENG_SHI, HUAN_SHOU_DAO, GONG_SHOU], {
      [weaponId]: instanceIdOfDefinition(state, GONG_SHOU),
    });
    expect(damageOf(events)).toBe((20 + 20 + 10 + 10) * (1 + 1 + 0));
  });

  it('空位隔断相邻关系，武器不形成匹配', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, HUAN_SHOU_DAO]);
    const { events } = playOnce(state, [MENG_SHI, null, HUAN_SHOU_DAO]);
    expect(damageOf(events)).toBe((20 + 10 + 5) * (1 + 1 + 0));
  });

  it('任意卡牌隔断相邻关系，武器不跨过战术绑定人物', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, LEI_GU, HUAN_SHOU_DAO]);
    const { events } = playOnce(state, [MENG_SHI, LEI_GU, HUAN_SHOU_DAO]);
    expect(damageOf(events)).toBe((20 + 20 + 10 + 5 + 5) * (1 + 0 + 1));
  });

  it('可以查询需要选择目标的武器及其候选人', () => {
    const state = startBattleWith(createPreparedState());
    const slots = [
      instanceIdOfDefinition(state, MENG_SHI),
      instanceIdOfDefinition(state, HUAN_SHOU_DAO),
      instanceIdOfDefinition(state, GONG_SHOU),
      null,
      null,
    ];
    const needing = findWeaponsNeedingTarget(slots, state.cards, definitions);
    expect(needing).toHaveLength(1);
    expect(needing[0]?.candidateInstanceIds).toHaveLength(2);

    const target = selectWeaponTarget(needing, slots[1] as never, slots[0] as never);
    expect(target.ok).toBe(true);
    const rejected = selectWeaponTarget(needing, slots[1] as never, slots[3] as never);
    expect(rejected.ok).toBe(false);
  });
});

/**
 * 配属只该问一次。
 *
 * 出牌框每动一下就重新判定配属，但只有「武器或目标已经不在身边」的那些才作废：
 * 否则玩家摆一张牌、收一张牌就要重新指定一遍，出战流程会被打断成碎片。
 */
describe('出牌框变动后的配属', () => {
  const MENG = () => MENG_SHI;
  const GONG = () => GONG_SHOU;

  function stage(state: GameState, definitionId: DefinitionId, slotIndex: number): GameState {
    const result = stageCard(state, instanceIdOfDefinition(state, definitionId), slotIndex);
    if (!result.ok) throw new Error(`摆牌失败：${result.error.message}`);
    return result.value;
  }

  function unstage(state: GameState, slotIndex: number): GameState {
    const result = unstageCard(state, slotIndex);
    if (!result.ok) throw new Error(`撤牌失败：${result.error.message}`);
    return result.value;
  }

  /** 摆成 人物-兵器-人物，并把兵器指定给左边那位。 */
  function assigned(): { state: GameState; weapon: string; target: string } {
    const base = setHand(startBattleWith(createPreparedState()), [MENG(), HUAN_SHOU_DAO, GONG(), LEI_GU]);
    const state = stage(stage(stage(base, MENG(), 0), HUAN_SHOU_DAO, 1), GONG(), 2);
    const weapon = instanceIdOfDefinition(state, HUAN_SHOU_DAO);
    const target = instanceIdOfDefinition(state, MENG());
    const needing = findWeaponsNeedingTarget(state.zones.playSlots, state.cards, definitions);
    expect(selectWeaponTarget(needing, weapon as never, target as never).ok).toBe(true);
    return { state: { ...state, equipmentTargets: { [weapon]: target } }, weapon, target };
  }

  it('指定一次之后再往框里加牌，不必重新指定', () => {
    const { state, weapon, target } = assigned();
    const after = stage(state, LEI_GU, 3);
    expect(after.equipmentTargets[weapon]).toBe(target);
  });

  it('拿走一张不相关的牌，配属同样保留', () => {
    const { state, weapon, target } = assigned();
    const after = unstage(stage(state, LEI_GU, 3), 3);
    expect(after.equipmentTargets[weapon]).toBe(target);
  });

  it('配属保留后可以直接出战，不要求再次指定', () => {
    const { state } = assigned();
    const after = stage(state, LEI_GU, 3);
    const result = playCards({
      state: after,
      rules,
      rng,
      definitions,
      assignments: after.zones.playSlots.flatMap((instanceId, slotIndex) =>
        instanceId === null || instanceId === undefined ? [] : [{ slotIndex, instanceId }],
      ),
    });
    expect(result.ok).toBe(true);
  });

  it('被指定的人物拿下来，这条配属作废', () => {
    const { state, weapon } = assigned();
    const after = unstage(state, 0);
    expect(after.equipmentTargets[weapon]).toBeUndefined();
  });

  it('兵器自己拿下来，配属作废', () => {
    const { state, weapon } = assigned();
    const after = unstage(state, 1);
    expect(after.equipmentTargets[weapon]).toBeUndefined();
  });

  it('兵器挪到不与目标相邻的位置，配属作废（留着会被判非法目标）', () => {
    const { state, weapon } = assigned();
    const after = stage(unstage(state, 1), HUAN_SHOU_DAO, 4);
    expect(after.equipmentTargets[weapon]).toBeUndefined();
  });
});

describe('军势', () => {
  it('按人物数量锁定档位', () => {
    expect(resolveMoraleTier(10, rules)).toBe('none');
    expect(resolveMoraleTier(12, rules)).toBe('formed');
    expect(resolveMoraleTier(16, rules)).toBe('array');
  });

  it('本次出战的人物各获得 1 点军势并立即参与结算', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, HUAN_SHOU_DAO]);
    const { state: after } = playOnce(state, [MENG_SHI, HUAN_SHOU_DAO]);
    expect(after.battle?.moraleTotal).toBe(1);
  });

  it('列阵档位额外提供每 5 点军势 1 点增幅', () => {
    const breakdown = calculateDamage({
      participantIds: [],
      cards: {},
      definitions,
      bindings: [],
      moraleTotal: 10,
      moraleTier: 'array',
      rules,
    });
    expect(breakdown.moralePower).toBe(50);
    expect(breakdown.moraleAmp).toBe(2);
    expect(breakdown.damage).toBe(50 * (1 + 2));
  });
});

describe('牌区流转', () => {
  it('抽牌堆不足时洗回弃牌堆，移除区不参与', () => {
    const base = startBattleWith(createPreparedState());
    const [first, second, third, removed] = base.zones.hand;
    if (first === undefined || second === undefined || third === undefined || removed === undefined) {
      throw new Error('手牌不足，无法构造场景');
    }
    const state: GameState = {
      ...base,
      cards: {
        ...base.cards,
        [first]: withZone(base.cards[first]!, 'drawPile'),
        [second]: withZone(base.cards[second]!, 'discardPile'),
        [third]: withZone(base.cards[third]!, 'discardPile'),
        [removed]: withZone(base.cards[removed]!, 'removed'),
      },
      zones: { ...base.zones, drawPile: [first], hand: [], discardPile: [second, third], removed: [removed] },
    };
    const outcome = drawCards(state, rng, 3);
    expect(outcome.reshuffledCount).toBe(2);
    expect(outcome.drawn).toHaveLength(3);
    expect(outcome.state.zones.hand).toHaveLength(3);
    expect(outcome.drawn).not.toContain(removed);
    expect(outcome.state.cards[removed]?.zone).toBe('removed');
  });

  it('弃牌堆洗回后，尚未抽到的实例同步标记为抽牌堆', () => {
    const base = startBattleWith(createPreparedState());
    const [first, second] = base.zones.hand;
    if (first === undefined || second === undefined) {
      throw new Error('手牌不足，无法构造场景');
    }
    const state: GameState = {
      ...base,
      cards: {
        ...base.cards,
        [first]: withZone(base.cards[first]!, 'discardPile'),
        [second]: withZone(base.cards[second]!, 'discardPile'),
      },
      zones: { ...base.zones, drawPile: [], hand: [], discardPile: [first, second] },
    };

    const outcome = drawCards(state, rng, 1);
    const remaining = outcome.state.zones.drawPile[0];
    expect(remaining).toBeDefined();
    expect(outcome.state.cards[remaining!]?.zone).toBe('drawPile');
  });
});

describe('主动弃牌', () => {
  it('消耗弃牌次数、进入弃牌堆并补抽等量', () => {
    const base = startBattleWith(createPreparedState());
    const picked = base.zones.hand.slice(0, 2);
    const result = discardCards({ state: base, rules, rng, instanceIds: picked });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.battle?.discardCountRemaining).toBe(2);
    expect(result.value.state.battle?.hasDiscardedThisBattle).toBe(true);
    expect(result.value.state.zones.hand).toHaveLength(8);
    expect(result.value.state.zones.discardPile.slice(0, 2)).toEqual(picked);
  });

  it('弃牌次数用尽后拒绝弃牌', () => {
    let state = startBattleWith(createPreparedState());
    for (let round = 0; round < 3; round += 1) {
      const result = discardCards({ state, rules, rng, instanceIds: state.zones.hand.slice(0, 1) });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.value.state;
    }
    const rejected = discardCards({ state, rules, rng, instanceIds: state.zones.hand.slice(0, 1) });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe(AppErrorCode.CommandRejected);
    }
  });

  it('弃牌不获得军势', () => {
    const base = startBattleWith(createPreparedState());
    const result = discardCards({ state: base, rules, rng, instanceIds: base.zones.hand.slice(0, 1) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.battle?.moraleTotal).toBe(0);
  });
});

describe('胜负判定', () => {
  it('敌人生命降至 0 立即胜利，并计入已胜场次', () => {
    const state = setHand(startBattleWith(createPreparedState(), HUANG_JIN_ID, 100), [MENG_SHI, HUAN_SHOU_DAO]);
    const { state: after, events } = playOnce(state, [MENG_SHI, HUAN_SHOU_DAO]);
    expect(damageOf(events)).toBeGreaterThanOrEqual(100);
    expect(after.battle?.status).toBe('won');
    expect(after.run.battlesWon).toBe(1);
    expect(after.run.status).toBe('running');
    expect(events.some((event) => event.type === 'BattleWon')).toBe(true);
  });

  it('出战次数用尽且敌人仍存活即失败', () => {
    const smallDeck = createPreparedState({ deckDefinitionIds: [MENG_SHI, HUAN_SHOU_DAO] });
    let state = startBattleWith(smallDeck, HUANG_JIN_ID, 1200);
    for (let round = 0; round < 4; round += 1) {
      const result = playCards({
        state,
        rules,
        rng,
        definitions,
        assignments: [
          { slotIndex: 0, instanceId: instanceIdOfDefinition(state, MENG_SHI) },
          { slotIndex: 1, instanceId: instanceIdOfDefinition(state, HUAN_SHOU_DAO) },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.value.state;
    }
    expect(state.battle?.status).toBe('lost');
    expect(state.battle?.enemyCurrentHp ?? 0).toBeGreaterThan(0);
    expect(state.run.status).toBe('lost');
  });

  it('战斗结束后清除本场临时状态与军势', () => {
    const smallDeck = createPreparedState({ deckDefinitionIds: [MENG_SHI, HUAN_SHOU_DAO] });
    const state = startBattleWith(smallDeck, HUANG_JIN_ID, 100);
    const { state: after } = playOnce(state, [MENG_SHI, HUAN_SHOU_DAO]);
    const character = Object.values(after.cards)[0];
    expect(character?.morale).toBe(0);
    expect(after.zones.playSlots.every((slot) => slot === null)).toBe(true);
    for (const instanceId of after.zones.drawPile) {
      expect(after.cards[instanceId]?.zone).toBe('drawPile');
    }
  });
});

describe('非法命令', () => {
  it('选择不在手牌的卡会被拒绝且不改变状态', () => {
    const state = startBattleWith(createPreparedState());
    const notInHand = state.zones.drawPile[0];
    if (notInHand === undefined) {
      throw new Error('抽牌堆为空，无法构造场景');
    }
    const result = playCards({
      state,
      rules,
      rng,
      definitions,
      assignments: [{ slotIndex: 0, instanceId: notInHand }],
    });
    expect(state.zones.hand.includes(notInHand)).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(AppErrorCode.InvalidCommand);
    }
  });

  it('重复占用同一格位会被拒绝', () => {
    const state = setHand(startBattleWith(createPreparedState()), [MENG_SHI, HUAN_SHOU_DAO]);
    const result = playCards({
      state,
      rules,
      rng,
      definitions,
      assignments: [
        { slotIndex: 1, instanceId: instanceIdOfDefinition(state, MENG_SHI) },
        { slotIndex: 1, instanceId: instanceIdOfDefinition(state, HUAN_SHOU_DAO) },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('未在战斗中出战或弃牌会被拒绝', () => {
    const state = createPreparedState();
    const played = playCards({ state, rules, rng, definitions, assignments: [] });
    expect(played.ok).toBe(false);
    const discarded = discardCards({ state, rules, rng, instanceIds: [] });
    expect(discarded.ok).toBe(false);
  });
});

describe('装备关系解析', () => {
  it('只有一侧紧邻人物时自动装备', () => {
    const state = startBattleWith(createPreparedState());
    const slots = [
      instanceIdOfDefinition(state, MENG_SHI),
      instanceIdOfDefinition(state, HUAN_SHOU_DAO),
      null,
      null,
      null,
    ];
    const result = resolveEquipments({ slots, cards: state.cards, definitions, rules, targets: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.weaponsNeedingTarget).toHaveLength(0);
    expect(result.value.bindings[0]?.relation).toBe('main');
    expect(result.value.bindings[0]?.ampBonus).toBe(4);
  });

  it('指定非相邻人物作为目标会被拒绝', () => {
    const state = startBattleWith(createPreparedState());
    const slots = [
      instanceIdOfDefinition(state, MENG_SHI),
      instanceIdOfDefinition(state, HUAN_SHOU_DAO),
      instanceIdOfDefinition(state, GONG_SHOU),
      null,
      null,
    ];
    const result = resolveEquipments({
      slots,
      cards: state.cards,
      definitions,
      rules,
      targets: { [slots[1] as string]: instanceIdOfDefinition(state, CE_SHI) },
    });
    expect(result.ok).toBe(false);
  });
});
