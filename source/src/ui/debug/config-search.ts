import type { EffectiveConfig } from '@config/config-registry';
import type { RuntimePatch } from '@config/runtime-patch';
import {
  ENHANCEMENT_TIERS,
  MATCH_RELATIONS,
  PROFESSIONS,
  WEAPON_CLASSES,
  type EnhancementTier,
  type MatchRelation,
  type Profession,
  type WeaponClass,
} from '@domain/models/enums';

/**
 * 配置目录：把散落在 EffectiveConfig 各处的数值摊成一张可搜索的平表。
 *
 * 目录里同时列出**不可热更新**的结构性字段（ID、类型、关系表、效果结构），
 * 它们只能「需重新加载内容」——列出来是为了让改参数的人当场看到边界在哪，
 * 而不是让他改完之后才发现补丁 Schema 根本不收。
 *
 * 这一层只做展示与定位，不写配置：写入一律走 RuntimePatch 的校验。
 */

/** 生效时机：改完什么时候能看到。 */
export type PatchTiming = 'immediate' | 'next_battle' | 'reload';

export const TIMING_TEXT: Readonly<Record<PatchTiming, string>> = {
  immediate: '立即生效',
  next_battle: '下一场战斗生效',
  reload: '需重新加载内容',
};

export interface ConfigEntry {
  /** 稳定 key，列表渲染用。 */
  readonly id: string;
  /** 补丁路径，按段存放：卡牌与敌人的 ID 里有点号，按点切分会把 ID 拆碎。 */
  readonly path: readonly string[];
  readonly group: string;
  readonly owner: string;
  readonly label: string;
  /** 结构性字段没有可编辑的数值，只显示一段说明文本。 */
  readonly kind: 'number' | 'boolean' | 'text';
  readonly base: number | boolean | string;
  readonly patchable: boolean;
  readonly timing: PatchTiming;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const BIG = 1_000_000;

const BATTLE_LABELS: Readonly<Record<string, string>> = {
  handLimit: '手牌上限',
  playCount: '每场出战次数',
  discardCount: '每场弃牌次数',
  playSlotCount: '出牌框格数',
  maxDiscardSelection: '单次弃牌上限',
};

const DAMAGE_LABELS: Readonly<Record<string, string>> = {
  basePower: '威力区起始值',
  baseAmp: '增幅区起始值',
};

const MORALE_LABELS: Readonly<Record<string, string>> = {
  noneMaxCharacterCount: '未成军人数上限',
  formedMaxCharacterCount: '成军人数上限',
  powerPerPoint: '每点军势提供威力',
  ampPerPoints: '每多少点军势 +1 增幅',
};

const ECONOMY_LABELS: Readonly<Record<string, string>> = {
  initialGold: '初始金币',
  victoryGold: '每胜一场金币',
  rerollCost: '刷新花费',
  maxRerollsPerStage: '每阶段刷新上限',
};

const RELATION_LABELS: Readonly<Record<MatchRelation, string>> = {
  main: '本职增幅',
  usable: '可用增幅',
  off: '偏门增幅',
  none: '不匹配增幅',
};

const TIER_LABELS: Readonly<Record<EnhancementTier, string>> = {
  common: '普通档',
  rare: '稀有档',
  legendary: '传说档',
};

const PRESENTATION_LABELS: Readonly<Record<string, string>> = {
  animationEnabled: '开启动画',
  damageTickMs: '伤害跳动时长',
  cardMoveMs: '卡牌移动时长',
  cardFlipMs: '翻牌时长',
  glowFadeMs: '光效淡出时长',
};

const DRAG_LABELS: Readonly<Record<string, string>> = {
  startThresholdPx: '拖拽启动阈值',
  snapDistancePx: '落点吸附距离',
};

const CARD_VIEW_LABELS: Readonly<Record<string, string>> = {
  hoverScale: '悬停缩放',
  glowIntensity: '光效强度',
};

const PROFESSION_LABELS: Readonly<Record<Profession, string>> = {
  warrior: '武者',
  archer: '弓手',
  strategist: '谋士',
  assassin: '暗客',
  guard: '卫士',
};

const WEAPON_CLASS_LABELS: Readonly<Record<WeaponClass, string>> = {
  blade: '刀',
  spear: '枪',
  bow: '弓',
  implement: '法器',
  hidden: '暗器',
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  character: '人物',
  weapon: '武器',
  tactic: '战术',
  event: '事件',
};

const RARITY_LABELS: Readonly<Record<string, string>> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

interface EntrySeed {
  readonly id: string;
  readonly path: readonly string[];
  readonly group: string;
  readonly owner: string;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly value: number | boolean | string;
  readonly patchable: boolean;
  readonly timing: PatchTiming;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

function toEntry(seed: EntrySeed): ConfigEntry {
  return {
    id: seed.id,
    path: seed.path,
    group: seed.group,
    owner: seed.owner,
    label: seed.label,
    kind: typeof seed.value === 'boolean'
      ? 'boolean'
      : typeof seed.value === 'number'
        ? 'number'
        : 'text',
    base: seed.value,
    patchable: seed.patchable,
    timing: seed.timing,
    min: seed.min ?? 0,
    max: seed.max ?? BIG,
    step: seed.step ?? 1,
  };
}

/** 摊平成一张表；顺序固定，搜索结果的顺序也才可预期。 */
export function buildCatalog(config: EffectiveConfig): readonly ConfigEntry[] {
  const entries: ConfigEntry[] = [];

  for (const card of config.cards.values()) {
    entries.push(toEntry({
      id: `card.${card.id}.basePower`,
      path: ['cardStats', card.id, 'basePower'],
      group: '卡牌',
      owner: card.name,
      label: '基础威力',
      keywords: [card.id, card.name, 'basePower', '威力'],
      value: card.basePower,
      patchable: true,
      timing: 'immediate',
      max: 9_999,
    }));
    if ('baseAmp' in card) {
      entries.push(toEntry({
        id: `card.${card.id}.baseAmp`,
        path: ['cardStats', card.id, 'baseAmp'],
        group: '卡牌',
        owner: card.name,
        label: '基础增幅',
        keywords: [card.id, card.name, 'baseAmp', '增幅'],
        value: card.baseAmp,
        patchable: true,
        timing: 'immediate',
        max: 9_999,
      }));
    }
    // 结构性：这些字段没有补丁入口，只能重新加载内容。
    entries.push(toEntry({
      id: `card.${card.id}.cardType`,
      path: [],
      group: '卡牌（结构性）',
      owner: card.name,
      label: '卡牌类型',
      keywords: [card.id, card.name, 'cardType', '类型'],
      value: TYPE_LABELS[card.cardType] ?? card.cardType,
      patchable: false,
      timing: 'reload',
    }));
    entries.push(toEntry({
      id: `card.${card.id}.rarity`,
      path: [],
      group: '卡牌（结构性）',
      owner: card.name,
      label: '稀有度',
      keywords: [card.id, card.name, 'rarity', '稀有度'],
      value: RARITY_LABELS[card.rarity] ?? card.rarity,
      patchable: false,
      timing: 'reload',
    }));
  }

  for (const enemy of config.enemies.values()) {
    entries.push(toEntry({
      id: `enemy.${enemy.id}.maxHp`,
      path: ['enemyStats', enemy.id, 'maxHp'],
      group: '敌人',
      owner: enemy.name,
      label: '生命上限',
      keywords: [enemy.id, enemy.name, 'maxHp', '生命', '血量'],
      value: enemy.maxHp,
      patchable: true,
      timing: 'next_battle',
      min: 1,
      max: 999_999,
    }));
  }

  const battle = config.battle as unknown as Record<string, number>;
  for (const [field, label] of Object.entries(BATTLE_LABELS)) {
    entries.push(toEntry({
      id: `balance.battle.${field}`,
      path: ['balance', 'battle', field],
      group: '战斗',
      owner: '战斗规则',
      label,
      keywords: ['battle', field, label],
      value: battle[field] ?? 0,
      patchable: true,
      // 格数决定牌区结构，改了必须重开一局，不算「下一场」。
      timing: field === 'playSlotCount' ? 'reload' : 'next_battle',
      max: 999,
    }));
  }

  const damage = config.damage as unknown as Record<string, number>;
  for (const [field, label] of Object.entries(DAMAGE_LABELS)) {
    entries.push(toEntry({
      id: `balance.damage.${field}`,
      path: ['balance', 'damage', field],
      group: '伤害',
      owner: '伤害公式',
      label,
      keywords: ['damage', field, label],
      value: damage[field] ?? 0,
      patchable: true,
      timing: 'immediate',
      max: 9_999,
    }));
  }

  const morale = config.morale as unknown as Record<string, number>;
  for (const [field, label] of Object.entries(MORALE_LABELS)) {
    entries.push(toEntry({
      id: `balance.morale.${field}`,
      path: ['balance', 'morale', field],
      group: '军势',
      owner: '军势',
      label,
      keywords: ['morale', '军势', field, label],
      value: morale[field] ?? 0,
      patchable: true,
      // 档位在开战时锁定，只有换算比例是当场生效的。
      timing: field.endsWith('CharacterCount') ? 'next_battle' : 'immediate',
      max: 9_999,
    }));
  }

  for (const relation of MATCH_RELATIONS) {
    entries.push(toEntry({
      id: `balance.matchMatrix.relationAmp.${relation}`,
      path: ['balance', 'matchMatrix', 'relationAmp', relation],
      group: '匹配',
      owner: '职业 × 兵器',
      label: RELATION_LABELS[relation],
      keywords: ['matchMatrix', 'relationAmp', relation, RELATION_LABELS[relation], '增幅'],
      value: config.matchMatrix.relationAmp[relation] ?? 0,
      patchable: true,
      timing: 'immediate',
      max: 999,
    }));
  }

  for (const profession of PROFESSIONS) {
    for (const weaponClass of WEAPON_CLASSES) {
      const relation = config.matchMatrix.matrix[profession]?.[weaponClass] ?? 'none';
      entries.push(toEntry({
        id: `balance.matchMatrix.matrix.${profession}.${weaponClass}`,
        path: [],
        group: '匹配（结构性）',
        owner: `${PROFESSION_LABELS[profession]} × ${WEAPON_CLASS_LABELS[weaponClass]}`,
        label: '匹配档位',
        keywords: ['matchMatrix', profession, weaponClass, '档位', '本职'],
        value: RELATION_LABELS[relation].replace('增幅', ''),
        patchable: false,
        timing: 'reload',
      }));
    }
  }

  const economy = config.economy as unknown as Record<string, number>;
  for (const [field, label] of Object.entries(ECONOMY_LABELS)) {
    entries.push(toEntry({
      id: `balance.economy.${field}`,
      path: ['balance', 'economy', field],
      group: '经济',
      owner: '金币',
      label,
      keywords: ['economy', '金币', field, label],
      value: economy[field] ?? 0,
      patchable: true,
      timing: 'next_battle',
      max: 9_999,
    }));
  }

  entries.push(toEntry({
    id: 'balance.enhancement.candidateCount',
    path: ['balance', 'enhancement', 'candidateCount'],
    group: '强化',
    owner: '战后强化',
    label: '候选数量',
    keywords: ['enhancement', 'candidateCount', '候选', '强化'],
    value: config.enhancement.candidateCount,
    patchable: true,
    timing: 'next_battle',
    max: 99,
  }));

  for (const [stage, weights] of Object.entries(config.enhancement.stageWeights)) {
    for (const tier of ENHANCEMENT_TIERS) {
      entries.push(toEntry({
        id: `balance.enhancement.stageWeights.${stage}.${tier}`,
        path: ['balance', 'enhancement', 'stageWeights', stage, tier],
        group: '强化',
        owner: `${stage} · ${TIER_LABELS[tier]}`,
        label: '档位权重',
        keywords: ['enhancement', 'stageWeights', stage, tier, '权重', TIER_LABELS[tier]],
        value: weights?.[tier] ?? 0,
        patchable: true,
        timing: 'next_battle',
        max: 9_999,
      }));
    }
  }

  for (const tier of ENHANCEMENT_TIERS) {
    const values = config.enhancement.tierValues[tier];
    entries.push(toEntry({
      id: `balance.enhancement.tierValues.${tier}.power`,
      path: ['balance', 'enhancement', 'tierValues', tier, 'power'],
      group: '强化',
      owner: TIER_LABELS[tier],
      label: '提供威力',
      keywords: ['enhancement', 'tierValues', tier, 'power', '威力'],
      value: values?.power ?? 0,
      patchable: true,
      timing: 'next_battle',
      max: 9_999,
    }));
    entries.push(toEntry({
      id: `balance.enhancement.tierValues.${tier}.amp`,
      path: ['balance', 'enhancement', 'tierValues', tier, 'amp'],
      group: '强化',
      owner: TIER_LABELS[tier],
      label: '提供增幅',
      keywords: ['enhancement', 'tierValues', tier, 'amp', '增幅'],
      value: values?.amp ?? 0,
      patchable: true,
      timing: 'next_battle',
      max: 9_999,
    }));
  }

  const animation = config.presentation.animation as unknown as Record<string, number | boolean>;
  for (const [field, label] of Object.entries(PRESENTATION_LABELS)) {
    entries.push(toEntry({
      id: `presentation.animation.${field}`,
      path: field === 'animationEnabled' ? ['presentation', 'animationEnabled'] : ['presentation', field],
      group: '表现',
      owner: '动画',
      label,
      keywords: ['presentation', 'animation', field, label],
      value: animation[field] ?? 0,
      patchable: true,
      timing: 'immediate',
      max: 9_999,
    }));
  }

  const drag = config.presentation.drag as unknown as Record<string, number>;
  for (const [field, label] of Object.entries(DRAG_LABELS)) {
    entries.push(toEntry({
      id: `presentation.drag.${field}`,
      path: ['presentation', 'drag', field],
      group: '表现',
      owner: '拖拽',
      label,
      keywords: ['presentation', 'drag', field, label],
      value: drag[field] ?? 0,
      patchable: true,
      timing: 'immediate',
      max: 999,
    }));
  }

  const cardView = config.presentation.card as unknown as Record<string, number>;
  for (const [field, label] of Object.entries(CARD_VIEW_LABELS)) {
    entries.push(toEntry({
      id: `presentation.card.${field}`,
      path: ['presentation', 'card', field],
      group: '表现',
      owner: '卡面',
      label,
      keywords: ['presentation', 'card', field, label],
      value: cardView[field] ?? 0,
      patchable: true,
      timing: 'immediate',
      max: 9_999,
      step: 0.05,
    }));
  }

  return entries;
}

/** 按 ID、名称、字段路径、字段标签搜索；空查询返回全表。 */
export function searchCatalog(
  entries: readonly ConfigEntry[],
  query: string,
): readonly ConfigEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return entries;
  return entries.filter((entry) => {
    const haystack = `${pathText(entry)} ${entry.group} ${entry.owner} ${entry.label} ${entry.id}`;
    return haystack.toLowerCase().includes(needle);
  });
}

/** 显示用的路径文本；结构性条目没有路径，退回条目 key。 */
export function pathText(entry: ConfigEntry): string {
  return entry.path.length === 0 ? entry.id : entry.path.join('.');
}

/** 读补丁里这一项的覆盖值；没覆盖返回 undefined。 */
export function readOverride(
  patch: RuntimePatch,
  path: readonly string[],
): number | boolean | undefined {
  if (path.length === 0) return undefined;
  let node: unknown = patch;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === 'number' || typeof node === 'boolean' ? node : undefined;
}

export function effectiveValue(entry: ConfigEntry, patch: RuntimePatch): number | boolean | string {
  const override = readOverride(patch, entry.path);
  return override === undefined ? entry.base : override;
}

export function hasOverride(entry: ConfigEntry, patch: RuntimePatch): boolean {
  return readOverride(patch, entry.path) !== undefined;
}
