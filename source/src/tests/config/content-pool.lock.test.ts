import { describe, expect, it } from 'vitest';
import { createConfigRegistry } from '@config/config-registry';
import { CARD_TYPES, ENHANCEMENT_TIERS } from '@domain/models/enums';
import { createCardInstances } from '@domain/models/card-instance-factory';

/**
 * 内容池锁定。
 *
 * 里程碑收口时要守的不是「有多少张卡」（那在 config-registry 里守过了），
 * 而是那些一旦漂移就会伤到存档与扩展的东西：ID 形状、唯一性、不该出现的内容、
 * 以及概率表自己是否自洽。ID 一进存档就不能再改，所以这里按模式锁死。
 */

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;
const config = registry.config;

/** 稳定 ID：全小写 ASCII、点分命名空间、下划线词组。 */
const ID_PATTERN = /^three_kingdoms\.[a-z0-9_]+(\.[a-z0-9_]+)+$/;

describe('内容池锁定', () => {
  it('所有定义 ID 都符合稳定 ID 形状，且全库唯一', () => {
    const ids = [
      ...registry.listCardDefinitions().map((card) => card.id),
      ...registry.listEnemyDefinitions().map((enemy) => enemy.id),
      ...[...config.runs.values()].flatMap((run) => [run.id, ...run.nodes.map((node) => node.id)]),
      ...config.enhancement.legendarySkillPool.map((skill) => skill.id),
    ];

    for (const id of ids) {
      expect(id, `ID 形状不合规：${id}`).toMatch(ID_PATTERN);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('内容池里没有事件卡——首版不实现事件定义、效果与本场消耗区流转', () => {
    const counts = new Map<string, number>();
    for (const card of registry.listCardDefinitions()) {
      counts.set(card.cardType, (counts.get(card.cardType) ?? 0) + 1);
    }
    expect(counts.get('event') ?? 0).toBe(0);
    // 四种类型都在协议里，只是事件暂时没有内容，避免以后加事件卡时改动枚举。
    expect(CARD_TYPES).toContain('event');
    expect([...counts.keys()].sort()).toEqual(['character', 'tactic', 'weapon']);
  });

  it('初始牌组每张定义恰好一个实例，共 20 个且互不相同', () => {
    const instances = createCardInstances(
      registry.listCardDefinitions().map((card) => card.id as never),
    );
    expect(instances).toHaveLength(20);
    expect(new Set(instances.map((instance) => instance.instanceId)).size).toBe(20);
    expect(new Set(instances.map((instance) => instance.definitionId)).size).toBe(20);
  });

  it('传说附加技能池固定 6 条，档位数值与强化概率表自洽', () => {
    expect(config.enhancement.legendarySkillPool).toHaveLength(6);

    const tiers = Object.values(config.enhancement.tierValues);
    expect(tiers).toHaveLength(ENHANCEMENT_TIERS.length);
    for (const tier of ENHANCEMENT_TIERS) {
      expect(config.enhancement.tierValues[tier]).toBeDefined();
    }

    // 每个奖励阶段的权重是概率分布，权重和必须为 100，否则抽取比例会与设计不符。
    for (const [stage, weights] of Object.entries(config.enhancement.stageWeights)) {
      const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
      expect(sum, `${stage} 的档位权重和`).toBe(100);
      expect(config.enhancement.candidateCount).toBeGreaterThan(0);
    }
  });

  it('三场流程的敌人血量与本局经济就是冻结值，改动必须同时改文档', () => {
    const enemies = [...config.enemies.values()].map((enemy) => enemy.maxHp);
    expect(enemies).toEqual([1200, 2200, 3600]);
    expect(config.economy).toEqual({
      initialGold: 2,
      victoryGold: 1,
      rerollCost: 1,
      maxRerollsPerStage: 2,
    });
    expect(config.battle).toEqual({
      handLimit: 8,
      playCount: 4,
      discardCount: 3,
      playSlotCount: 5,
      maxDiscardSelection: 5,
    });
  });
});
