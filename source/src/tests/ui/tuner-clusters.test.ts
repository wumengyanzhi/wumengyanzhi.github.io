import { describe, expect, it } from 'vitest';
import { createConfigRegistry } from '@config/config-registry';
import { buildCatalog, searchCatalog, type ConfigEntry } from '@ui/debug/config-search';
import {
  buildClusters,
  filterClusters,
  groupClusters,
  type EntryCluster,
} from '@ui/debug/cluster';

/**
 * 参数卡片的分组。
 *
 * 面板重组之后最怕两件事：某一项被分丢了，或者同一张卡被拆到两片里。
 * 这两件都能用纯函数断言——分组不依赖 DOM，也不碰补丁。
 */

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const catalog = buildCatalog(loaded.value.config);
const clusters = buildClusters(catalog);

function idsOf(list: readonly ConfigEntry[]): string[] {
  return list.map((entry) => entry.id);
}

function entriesOf(list: readonly EntryCluster[]): readonly ConfigEntry[] {
  return list.flatMap((cluster) => [...cluster.entries]);
}

describe('调参面板分组', () => {
  it('每一项都落到某一簇里，既不重复也不遗漏', () => {
    const spread = idsOf(entriesOf(clusters)).sort();
    expect(spread).toEqual(idsOf([...catalog]).sort());
  });

  it('同一张卡牌的数值、类型与稀有度在同一簇里', () => {
    const cards = clusters.filter((cluster) => cluster.kind === 'card');
    expect(cards.length).toBeGreaterThan(0);
    for (const cluster of cards) {
      const owners = new Set(cluster.entries.map((entry) => entry.owner));
      expect(owners.size).toBe(1);
      expect(cluster.entries.every((entry) => entry.id.startsWith('card.'))).toBe(true);
    }
    // 卡牌数量与目录里的卡一致：每张卡至少占一簇，卡与簇一一对应。
    const cardIds = new Set(
      catalog.filter((entry) => entry.id.startsWith('card.')).map((entry) => entry.owner),
    );
    expect(cards).toHaveLength(cardIds.size);
  });

  it('卡牌按人物、武器、战术排，规则簇排在后面', () => {
    const tones = clusters.map((cluster) => cluster.tone);
    const firstRule = tones.indexOf('rule');
    const lastCard = Math.max(
      tones.lastIndexOf('character'),
      tones.lastIndexOf('weapon'),
      tones.lastIndexOf('tactic'),
    );
    expect(lastCard).toBeLessThan(firstRule === -1 ? tones.length : firstRule);
    expect(tones.indexOf('character')).toBeLessThan(tones.lastIndexOf('weapon'));
    expect(tones.lastIndexOf('weapon')).toBeLessThan(tones.lastIndexOf('tactic'));
  });

  it('规则簇的副标题写出里面有什么', () => {
    const byId = new Map(clusters.map((cluster) => [cluster.id, cluster]));
    expect(byId.get('battle')?.meta).toContain('伤害公式');
    expect(byId.get('matchMatrix')?.meta).toContain('档位表');
    expect(byId.get('enhancement')?.meta).toContain('档位数值');
    expect(byId.get('presentation')?.meta).toContain('拖拽');
  });

  it('高频参数排在小节前面', () => {
    const battle = clusters.find((cluster) => cluster.id === 'battle');
    if (battle === undefined) throw new Error('缺少战斗规则簇');
    const order = idsOf(entriesOf([battle]));
    expect(order.indexOf('balance.battle.playCount')).toBeLessThan(
      order.indexOf('balance.battle.playSlotCount'),
    );
    expect(order.indexOf('balance.damage.basePower')).toBeLessThan(
      order.indexOf('balance.morale.formedMaxCharacterCount'),
    );
  });

  it('搜索只留下命中的条目，簇内条数加起来等于命中数', () => {
    for (const needle of ['环首刀', 'morale', 'maxHp', '权重']) {
      const matched = searchCatalog(catalog, needle);
      const kept = filterClusters(clusters, matched);
      expect(entriesOf(kept)).toHaveLength(matched.length);
      expect(idsOf(entriesOf(kept)).sort()).toEqual(idsOf(matched).sort());
    }
  });

  it('四段分区覆盖所有簇，空段不出现', () => {
    const groups = groupClusters(clusters);
    const spread = groups.flatMap((group) => [...group.clusters]);
    expect(spread).toHaveLength(clusters.length);
    for (const group of groups) {
      expect(group.clusters.length).toBeGreaterThan(0);
    }
  });
});
