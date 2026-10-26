import { describe, expect, it } from 'vitest';
import { createConfigRegistry, CONTENT_VERSION } from '@config/config-registry';
import { validateBalance, validateContent } from '@config/config-validator';

const registryResult = createConfigRegistry();
if (!registryResult.ok) {
  throw new Error(`基础配置未通过验证：${JSON.stringify(registryResult.error, null, 2)}`);
}
const registry = registryResult.value;
const config = registry.config;

describe('MVP 配置内容', () => {
  it('基础配置可以加载并通过验证', () => {
    expect(config.contentVersion).toBe(CONTENT_VERSION);
  });

  it('冻结 20 张初始牌组：12 人物、5 武器、3 战术', () => {
    const cards = registry.listCardDefinitions();
    expect(cards).toHaveLength(20);
    expect(cards.filter((card) => card.cardType === 'character')).toHaveLength(12);
    expect(cards.filter((card) => card.cardType === 'weapon')).toHaveLength(5);
    expect(cards.filter((card) => card.cardType === 'tactic')).toHaveLength(3);
  });

  it('三场敌人与生命值取自冻结配置', () => {
    expect(registry.getEnemyDefinition('three_kingdoms.enemy.huang_jin_jun_zhen')?.maxHp).toBe(1200);
    expect(registry.getEnemyDefinition('three_kingdoms.enemy.xi_liang_tie_qi')?.maxHp).toBe(2200);
    expect(registry.getEnemyDefinition('three_kingdoms.enemy.hu_lao_mo_jiang')?.maxHp).toBe(3600);
  });

  it('战斗资源为手牌 8、出战 4、弃牌 3、出牌框 5', () => {
    expect(config.battle.handLimit).toBe(8);
    expect(config.battle.playCount).toBe(4);
    expect(config.battle.discardCount).toBe(3);
    expect(config.battle.playSlotCount).toBe(5);
  });

  it('伤害区起始值与军势成军参数来自配置', () => {
    expect(config.damage.basePower).toBe(0);
    expect(config.damage.baseAmp).toBe(1);
    expect(config.morale.powerPerPoint).toBe(5);
    expect(config.morale.noneMaxCharacterCount).toBe(10);
    expect(config.morale.formedMaxCharacterCount).toBe(15);
  });

  it('职业—武器匹配矩阵与固定增幅一致', () => {
    expect(config.matchMatrix.relationAmp).toEqual({ main: 4, usable: 2, off: 1, none: 0 });
    expect(config.matchMatrix.matrix['warrior']?.['blade']).toBe('main');
    expect(config.matchMatrix.matrix['guard']?.['spear']).toBe('main');
    expect(config.matchMatrix.matrix['archer']?.['hidden']).toBe('usable');
    expect(config.matchMatrix.matrix['strategist']?.['blade']).toBe('off');
  });

  it('经济与强化概率取自冻结配置', () => {
    expect(config.economy).toEqual({ initialGold: 2, victoryGold: 1, rerollCost: 1, maxRerollsPerStage: 2 });
    expect(config.enhancement.stageWeights['first_reward']).toEqual({ common: 60, rare: 35, legendary: 5 });
    expect(config.enhancement.stageWeights['second_reward']).toEqual({ common: 40, rare: 45, legendary: 15 });
    expect(config.enhancement.legendarySkillPool).toHaveLength(6);
  });

  it('三战流程的五个节点顺序与后继关系正确', () => {
    const run = registry.getRunDefinition('three_kingdoms.run.three_battle_mvp');
    expect(run?.nodes).toHaveLength(5);
    expect(run?.startNodeId).toBe('three_kingdoms.run_node.huang_jin_battle');
    expect(run?.nodes.map((node) => node.type)).toEqual(['battle', 'reward', 'battle', 'reward', 'battle']);
    expect(run?.nodes[4]?.nextNodeId).toBeNull();
  });

  it('卡牌技能参数进入配置而不是代码', () => {
    const character = registry.getCardDefinition('three_kingdoms.character.shu_zhong_xiao_jiang');
    expect(character?.effects[0]?.condition.type).toBe('self_equipped_weapon_relation');
    const tactic = registry.getCardDefinition('three_kingdoms.tactic.lei_gu_jin_jun');
    const operation = tactic?.effects[0]?.operations[0];
    expect(operation?.type).toBe('add_power');
    expect(operation !== undefined && 'scale' in operation ? operation.scale?.max : undefined).toBe(20);
  });
});

describe('配置校验失败路径', () => {
  const validCard = {
    id: 'test.character.a',
    name: '测试人物',
    cardType: 'character',
    rarity: 'common',
    faction: 'shu',
    profession: 'warrior',
    basePower: 20,
    effects: [],
  };
  const validRun = {
    id: 'test.run',
    name: '测试流程',
    startNodeId: 'test.node.battle',
    nodes: [
      { id: 'test.node.battle', type: 'battle', contentRef: 'test.enemy', nextNodeId: null },
    ],
  };
  const validEnhancement = {
    candidateCount: 3,
    stageWeights: { first_reward: { common: 60, rare: 35, legendary: 5 } },
    tierValues: { common: { power: 10, amp: 1 }, rare: { power: 20, amp: 2 }, legendary: { power: 20, amp: 2 } },
    allowedAttributes: {
      character: ['power'],
      weapon: ['power', 'amp'],
      tactic_power: ['power'],
      tactic_amp: ['amp'],
    },
    legendarySkillPool: [{ id: 'test.skill', name: '测试技能', text: '无', effect: { kind: 'first_play_power', value: 1 } }],
  };

  it('重复卡牌定义 ID 被拒绝并带出 ID', () => {
    const result = validateContent({
      cards: [validCard, { ...validCard }],
      enemies: [],
      run: validRun,
      enhancement: validEnhancement,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.path === 'test.character.a')).toBe(true);
    }
  });

  it('字段越界被拒绝并带出字段路径', () => {
    const result = validateContent({
      cards: [{ ...validCard, basePower: -5 }],
      enemies: [],
      run: validRun,
      enhancement: validEnhancement,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.source).toBe('content/cards');
      expect(result.error[0]?.path).toContain('basePower');
    }
  });

  it('战斗节点引用不存在的敌人被拒绝', () => {
    const result = validateContent({
      cards: [validCard],
      enemies: [],
      run: validRun,
      enhancement: validEnhancement,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.path.endsWith('contentRef'))).toBe(true);
    }
  });

  it('奖励节点引用不存在的概率表被拒绝', () => {
    const result = validateContent({
      cards: [validCard],
      enemies: [{ id: 'test.enemy', name: '测试敌人', type: 'normal', maxHp: 10, behavior: 'passive_health_race' }],
      run: {
        id: 'test.run',
        name: '测试流程',
        startNodeId: 'test.node.reward',
        nodes: [{ id: 'test.node.reward', type: 'reward', contentRef: 'missing_stage', nextNodeId: null }],
      },
      enhancement: validEnhancement,
    });
    expect(result.ok).toBe(false);
  });

  it('平衡配置缺少字段时被拒绝', () => {
    const result = validateBalance({
      battle: { handLimit: 8 },
      damage: { basePower: 0, baseAmp: 1 },
      morale: config.morale,
      matchMatrix: config.matchMatrix,
      economy: config.economy,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.source).toBe('balance/battle');
    }
  });
});
