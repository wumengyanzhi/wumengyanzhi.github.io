import type { ConfigEntry } from './config-search';

/**
 * 把摊平的目录收成一簇一簇。
 *
 * 目录本身只是一张表：谁的值、叫什么、路径在哪。面板要看得下去，还得回答两个问题——
 * 「这一堆数属于谁」和「这簇里有什么」。这里只回答这两个问题：
 *
 * 一、同一张卡牌的威力、增幅、类型、稀有度必须落在同一簇里，改一张卡不用在表里来回找；
 * 二、规则类参数按主题合簇（战斗规则、职业 × 兵器、战后强化……），簇的副标题直接写出内含的小节。
 *
 * 这一层不认识补丁，也不改名任何参数：它读的还是目录里那批条目，只是决定它们站哪儿、按什么顺序站。
 */

export type ClusterKind = 'card' | 'enemy' | 'rule';

export type ClusterTone = 'character' | 'weapon' | 'tactic' | 'enemy' | 'rule';

export interface ClusterSection {
  readonly id: string;
  /** 空串表示这一簇不用再分小节。 */
  readonly title: string;
  readonly entries: readonly ConfigEntry[];
  /** 匹配档位表是 5 × 5 的矩阵，按格子排比按行排好读。 */
  readonly layout: 'rows' | 'matrix';
}

export interface EntryCluster {
  readonly id: string;
  readonly title: string;
  readonly kind: ClusterKind;
  readonly tone: ClusterTone;
  /** 角标：卡牌写类型，其余留空。 */
  readonly badge: string;
  /** 副标题：卡牌写稀有度，规则簇写「里面有什么」。 */
  readonly meta: string;
  readonly sections: readonly ClusterSection[];
  readonly entries: readonly ConfigEntry[];
}

export interface ClusterGroup {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  readonly clusters: readonly EntryCluster[];
}

/** 卡牌在「卡牌」区里的排布顺序：人物 → 武器 → 战术。 */
const TONE_ORDER: readonly ClusterTone[] = ['character', 'weapon', 'tactic'];

export const TONE_TITLE: Readonly<Record<ClusterTone, string>> = {
  character: '人物',
  weapon: '武器',
  tactic: '战术',
  enemy: '敌人',
  rule: '规则',
};

const TYPE_TONE: Readonly<Record<string, ClusterTone>> = {
  人物: 'character',
  武器: 'weapon',
  战术: 'tactic',
  事件: 'tactic',
};

const SECTION_TITLE: Readonly<Record<string, string>> = {
  'balance.battle': '出牌与弃牌',
  'balance.damage': '伤害公式',
  'balance.morale': '军势',
  'balance.matchMatrix.relationAmp': '档位增幅',
  'balance.matchMatrix.matrix': '档位表（只读）',
  'balance.enhancement.candidateCount': '候选',
  'balance.enhancement.tierValues': '档位数值',
  'balance.enhancement.stageWeights': '阶段权重',
  'presentation.animation': '动画',
  'presentation.drag': '拖拽',
  'presentation.card': '卡面',
};

const CLUSTER_TITLE: Readonly<Record<string, string>> = {
  enemy: '敌人',
  battle: '战斗规则',
  matchMatrix: '职业 × 兵器匹配',
  enhancement: '战后强化',
  economy: '金币收支',
  presentation: '表现与手感',
};

/**
 * 高频参数靠前。
 *
 * 规则簇里参数一多就得有先后：最常拧的那几个放在手边，结构性字段压到最后。
 * 没有列进来的条目按「可热更新优先、其次原目录顺序」兜底。
 */
const FREQUENCY: Readonly<Record<string, readonly string[]>> = {
  battle: [
    'balance.battle.playCount',
    'balance.battle.discardCount',
    'balance.battle.handLimit',
    'balance.battle.maxDiscardSelection',
    'balance.damage.basePower',
    'balance.damage.baseAmp',
    'balance.morale.powerPerPoint',
    'balance.morale.ampPerPoints',
    'balance.morale.noneMaxCharacterCount',
    'balance.morale.formedMaxCharacterCount',
    'balance.battle.playSlotCount',
  ],
  matchMatrix: [
    'balance.matchMatrix.relationAmp.main',
    'balance.matchMatrix.relationAmp.usable',
    'balance.matchMatrix.relationAmp.off',
    'balance.matchMatrix.relationAmp.none',
  ],
  enhancement: [
    'balance.enhancement.candidateCount',
    'balance.enhancement.tierValues.common.power',
    'balance.enhancement.tierValues.common.amp',
    'balance.enhancement.tierValues.rare.power',
    'balance.enhancement.tierValues.rare.amp',
    'balance.enhancement.tierValues.legendary.power',
    'balance.enhancement.tierValues.legendary.amp',
  ],
  economy: [
    'balance.economy.initialGold',
    'balance.economy.victoryGold',
    'balance.economy.rerollCost',
    'balance.economy.maxRerollsPerStage',
  ],
  presentation: [
    'presentation.animation.animationEnabled',
    'presentation.animation.cardMoveMs',
    'presentation.animation.cardFlipMs',
    'presentation.animation.damageTickMs',
    'presentation.animation.glowFadeMs',
    'presentation.drag.startThresholdPx',
    'presentation.drag.snapDistancePx',
    'presentation.card.hoverScale',
    'presentation.card.glowIntensity',
  ],
};

const RULE_HINTS: Readonly<Record<string, string>> = {
  'balance.battle.playCount': '每场战斗能提交几次出牌，打完就进结算。',
  'balance.battle.discardCount': '每场能弃几次牌，弃掉的手牌本场不再回来。',
  'balance.battle.handLimit': '手牌上限，开战与每场结束都补到这个数。',
  'balance.battle.maxDiscardSelection': '一次弃牌最多能选几张。',
  'balance.battle.playSlotCount': '出牌框格数，改了要重开一局才生效。',
  'balance.damage.basePower': '威力区起始值，人物威力从这儿往上加。',
  'balance.damage.baseAmp': '增幅区起始值，武器配属与军势在它上面叠。',
  'balance.morale.powerPerPoint': '每点军势折算多少威力。',
  'balance.morale.ampPerPoints': '每多少点军势折算 +1 增幅。',
  'balance.morale.noneMaxCharacterCount': '未成军时，人数档位的上限。',
  'balance.morale.formedMaxCharacterCount': '成军时，人数档位的上限。',
  'balance.matchMatrix.relationAmp.main': '本职档位：武器对上本职职业时的增幅。',
  'balance.matchMatrix.relationAmp.usable': '可用档位：能拿但不出彩时的增幅。',
  'balance.matchMatrix.relationAmp.off': '偏门档位：勉强能用时的增幅。',
  'balance.matchMatrix.relationAmp.none': '不匹配档位：拿错了武器时的增幅。',
  'balance.economy.initialGold': '开局带的金币。',
  'balance.economy.victoryGold': '每胜一场进账多少金币。',
  'balance.economy.rerollCost': '刷新一次候选花多少金币。',
  'balance.economy.maxRerollsPerStage': '每个阶段最多能刷新几次。',
  'balance.enhancement.candidateCount': '战后强化一次给几个候选。',
  'presentation.animation.animationEnabled': '动画总开关，关掉后界面只走状态跳变。',
  'presentation.animation.cardMoveMs': '卡牌移动的动画时长，毫秒。',
  'presentation.animation.cardFlipMs': '翻牌动画时长，毫秒。',
  'presentation.animation.damageTickMs': '伤害数字跳动的总时长，毫秒。',
  'presentation.animation.glowFadeMs': '高亮光效淡出的时长，毫秒。',
  'presentation.drag.startThresholdPx': '手指移动多少像素才算开始拖拽。',
  'presentation.drag.snapDistancePx': '落点离格位多近才吸附进去。',
  'presentation.card.hoverScale': '悬停时卡牌放大的倍数。',
  'presentation.card.glowIntensity': '卡牌光效强度，0 为关闭。',
};

const CARD_HINTS: Readonly<Record<string, string>> = {
  basePower: '这张卡进战场时带的威力。',
  baseAmp: '这张卡进战场时带的增幅；武器只有配属给人物才按档位结算。',
  cardType: '卡牌类型，结构性字段，改它要重新加载内容。',
  rarity: '稀有度，结构性字段，改它要重新加载内容。',
};

const ENEMY_HINT = '敌人生命上限，改完下一场生效。';

/** 悬浮说明：规则参数查表，卡牌参数按字段后缀查表。 */
export function hintFor(entry: ConfigEntry): string {
  const byId = RULE_HINTS[entry.id];
  if (byId !== undefined) return byId;
  if (entry.path[0] === 'enemyStats') return ENEMY_HINT;
  if (entry.id.startsWith('card.')) {
    const cut = entry.id.lastIndexOf('.');
    return CARD_HINTS[entry.id.slice(cut + 1)] ?? '';
  }
  if (entry.id.startsWith('balance.enhancement.tierValues')) {
    return entry.label === '提供增幅' ? '这一档强化给多少增幅。' : '这一档强化给多少威力。';
  }
  if (entry.id.startsWith('balance.enhancement.stageWeights')) return '这个阶段抽到该档位的权重。';
  return '';
}

/** 条目归到哪一簇：优先看补丁路径，结构性条目没有路径，退回 id 前缀。 */
function clusterKey(entry: ConfigEntry): string {
  const head = entry.path[0];
  if (head === 'cardStats') return `card:${entry.path[1] ?? ''}`;
  if (head === 'enemyStats') return 'enemy';
  if (head === 'presentation') return 'presentation';
  if (head === 'balance') {
    const section = entry.path[1] ?? '';
    if (section === 'battle' || section === 'damage' || section === 'morale') return 'battle';
    return section;
  }
  // 结构性条目：卡牌的类型与稀有度、匹配档位表。
  if (entry.id.startsWith('card.')) {
    const rest = entry.id.slice('card.'.length);
    return `card:${rest.slice(0, rest.lastIndexOf('.'))}`;
  }
  if (entry.id.startsWith('balance.matchMatrix')) return 'matchMatrix';
  return `misc:${entry.id}`;
}

/** 簇内小节：同一主题的参数挨在一起，规则簇的副标题就是这些小节的名字。 */
function sectionKey(entry: ConfigEntry): string {
  const head = entry.path[0];
  if (head === 'presentation') {
    if (entry.path[1] === 'drag') return 'presentation.drag';
    if (entry.path[1] === 'card') return 'presentation.card';
    return 'presentation.animation';
  }
  if (head === 'balance') {
    const section = entry.path[1] ?? '';
    if (section === 'enhancement') return `balance.enhancement.${entry.path[2] ?? 'candidateCount'}`;
    if (section === 'matchMatrix') return `balance.matchMatrix.${entry.path[2] ?? 'relationAmp'}`;
    return `balance.${section}`;
  }
  if (entry.id.startsWith('balance.matchMatrix.matrix.')) return 'balance.matchMatrix.matrix';
  return '';
}

/** 高频优先，其次可热更新优先，最后保持目录原序。 */
function sortEntries(
  entries: readonly ConfigEntry[],
  priority: readonly string[],
): readonly ConfigEntry[] {
  const rank = (entry: ConfigEntry, index: number): number => {
    const hit = priority.indexOf(entry.id);
    if (hit >= 0) return hit;
    return priority.length + (entry.patchable ? 0 : 500) + index;
  };
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry, a.index) - rank(b.entry, b.index))
    .map((item) => item.entry);
}

function toSections(
  clusterId: string,
  entries: readonly ConfigEntry[],
): readonly ClusterSection[] {
  if (clusterId.startsWith('card:') || clusterId === 'enemy') {
    return [{ id: '', title: '', layout: 'rows', entries: sortEntries(entries, []) }];
  }
  const buckets = new Map<string, ConfigEntry[]>();
  const order: string[] = [];
  for (const entry of entries) {
    const key = sectionKey(entry);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [entry]);
      order.push(key);
    } else {
      bucket.push(entry);
    }
  }
  const priority = FREQUENCY[clusterId] ?? [];
  return order.map((key) => ({
    id: key,
    title: SECTION_TITLE[key] ?? '',
    layout: key === 'balance.matchMatrix.matrix' ? 'matrix' : 'rows',
    entries: sortEntries(buckets.get(key) ?? [], priority),
  }));
}

function toCluster(clusterId: string, entries: readonly ConfigEntry[]): EntryCluster {
  const sections = toSections(clusterId, entries);

  if (clusterId.startsWith('card:')) {
    const typeEntry = entries.find((entry) => entry.id.endsWith('.cardType'));
    const rarityEntry = entries.find((entry) => entry.id.endsWith('.rarity'));
    const typeText = typeof typeEntry?.base === 'string' ? typeEntry.base : '';
    return {
      id: clusterId,
      title: entries[0]?.owner ?? clusterId,
      kind: 'card',
      tone: TYPE_TONE[typeText] ?? 'rule',
      badge: typeText,
      meta: typeof rarityEntry?.base === 'string' ? rarityEntry.base : '',
      sections,
      entries,
    };
  }

  const kind: ClusterKind = clusterId === 'enemy' ? 'enemy' : 'rule';
  const title = CLUSTER_TITLE[clusterId] ?? clusterId;
  return {
    id: clusterId,
    title,
    kind,
    tone: kind === 'enemy' ? 'enemy' : 'rule',
    badge: '',
    meta: kind === 'enemy'
      ? `${entries.length} 名对手`
      : sections.map((section) => section.title).filter((text) => text !== '').join(' · '),
    sections,
    entries,
  };
}

/** 目录 → 簇。顺序固定：先卡牌（人物 / 武器 / 战术），再规则簇。 */
export function buildClusters(catalog: readonly ConfigEntry[]): readonly EntryCluster[] {
  const buckets = new Map<string, ConfigEntry[]>();
  const order: string[] = [];
  for (const entry of catalog) {
    const key = clusterKey(entry);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [entry]);
      order.push(key);
    } else {
      bucket.push(entry);
    }
  }

  const clusters = order.map((key) => toCluster(key, buckets.get(key) ?? []));
  const rank = (cluster: EntryCluster): number => {
    if (cluster.kind === 'card') return TONE_ORDER.indexOf(cluster.tone);
    return 10 + RULE_ORDER.indexOf(cluster.id);
  };
  return clusters
    .map((cluster, index) => ({ cluster, index, value: rank(cluster) }))
    .sort((a, b) => a.value - b.value || a.index - b.index)
    .map((item) => item.cluster);
}

const RULE_ORDER: readonly string[] = ['enemy', 'battle', 'matchMatrix', 'enhancement', 'economy', 'presentation'];

const GROUP_DEFS: readonly { readonly id: string; readonly title: string; readonly hint: string; readonly members: readonly string[] }[] = [
  {
    id: 'cards',
    title: '卡牌',
    hint: '同一张卡的威力、增幅、类型与稀有度放在一起，改动立即生效。',
    members: ['card'],
  },
  {
    id: 'battle',
    title: '战斗',
    hint: '对手血线、出牌与伤害规则、职业 × 兵器的匹配档位。',
    members: ['enemy', 'battle', 'matchMatrix'],
  },
  {
    id: 'growth',
    title: '成长与经济',
    hint: '战后强化的候选与档位数值，以及金币收支。',
    members: ['enhancement', 'economy'],
  },
  {
    id: 'presentation',
    title: '表现与手感',
    hint: '动画时长、拖拽阈值与卡面观感，全部立即生效。',
    members: ['presentation'],
  },
];

function groupOf(cluster: EntryCluster): string {
  return cluster.kind === 'card' ? 'card' : cluster.id;
}

/** 簇 → 顶部四段。空段不出现，搜索不到东西时整块留白由调用方处理。 */
export function groupClusters(clusters: readonly EntryCluster[]): readonly ClusterGroup[] {
  return GROUP_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    hint: def.hint,
    clusters: clusters.filter((cluster) => def.members.includes(groupOf(cluster))),
  })).filter((group) => group.clusters.length > 0);
}

/**
 * 按搜索结果裁剪：命中条目的簇留下，簇内只留命中的条目。
 * 簇本身的标题、类型与稀有度取自完整簇，认得出是谁就行。
 */
export function filterClusters(
  clusters: readonly EntryCluster[],
  matched: readonly ConfigEntry[],
): readonly EntryCluster[] {
  const hits = new Set(matched.map((entry) => entry.id));
  const kept: EntryCluster[] = [];
  for (const cluster of clusters) {
    const sections = cluster.sections
      .map((section) => ({ ...section, entries: section.entries.filter((entry) => hits.has(entry.id)) }))
      .filter((section) => section.entries.length > 0);
    if (sections.length === 0) continue;
    kept.push({ ...cluster, sections, entries: sections.flatMap((section) => [...section.entries]) });
  }
  return kept;
}
