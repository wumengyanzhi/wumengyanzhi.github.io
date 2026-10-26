/**
 * 领域枚举。
 *
 * 枚举、类型与协议属于程序常量，不属于可平衡数值，因此保留在代码中；
 * 配置层用 zod 复用下面这些常量数组，避免配置与领域各写一套产生漂移。
 */

export const CARD_TYPES = ['character', 'weapon', 'tactic', 'event'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export const FACTIONS = ['shu', 'wei', 'wu', 'qun'] as const;
export type Faction = (typeof FACTIONS)[number];

/** 武者、射手、术士、暗客、卫士。世界化显示名不改变底层类别。 */
export const PROFESSIONS = ['warrior', 'archer', 'strategist', 'assassin', 'guard'] as const;
export type Profession = (typeof PROFESSIONS)[number];

/** 刀、枪、弓、法器、暗器。 */
export const WEAPON_CLASSES = ['blade', 'spear', 'bow', 'implement', 'hidden'] as const;
export type WeaponClass = (typeof WEAPON_CLASSES)[number];

/** 本职、可用、偏门、不匹配。 */
export const MATCH_RELATIONS = ['main', 'usable', 'off', 'none'] as const;
export type MatchRelation = (typeof MATCH_RELATIONS)[number];

export const ZONE_TYPES = ['drawPile', 'hand', 'playSlot', 'discardPile', 'consumed', 'removed'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export const EFFECT_TIMINGS = ['on_play', 'after_resolve', 'on_battle_end'] as const;
export type EffectTiming = (typeof EFFECT_TIMINGS)[number];

/** 本次出战、本场战斗、本局永久。 */
export const STAT_SCOPES = ['this_play', 'this_battle', 'permanent'] as const;
export type StatScope = (typeof STAT_SCOPES)[number];

/** 未成军、成军、列阵。 */
export const MORALE_TIERS = ['none', 'formed', 'array'] as const;
export type MoraleTier = (typeof MORALE_TIERS)[number];

export const ENEMY_TYPES = ['normal', 'elite', 'boss'] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];

export const ENEMY_BEHAVIORS = ['passive_health_race'] as const;
export type EnemyBehavior = (typeof ENEMY_BEHAVIORS)[number];

/** MVP 只有战斗与战后强化两类节点；最后一个节点没有后继节点，代表本局通关。 */
export const RUN_NODE_TYPES = ['battle', 'reward'] as const;
export type RunNodeType = (typeof RUN_NODE_TYPES)[number];

export const TACTIC_DIRECTIONS = ['power', 'amp'] as const;
export type TacticDirection = (typeof TACTIC_DIRECTIONS)[number];

/** 效果作用目标：自身、本次出战整体、所装备的人物、快照中的左右相邻。 */
export const EFFECT_TARGETS = [
  'self',
  'zone',
  'equipped_character',
  'left_neighbour',
  'right_neighbour',
] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

/** 效果可读的数值层。基础与本局永久可被吸收；本场临时与本次不可。 */
export const STAT_LAYERS = ['base', 'permanent', 'battle_temporary', 'this_play'] as const;
export type StatLayer = (typeof STAT_LAYERS)[number];

export const ENHANCEMENT_TIERS = ['common', 'rare', 'legendary'] as const;
export type EnhancementTier = (typeof ENHANCEMENT_TIERS)[number];

export const BATTLE_STATUSES = ['in_progress', 'won', 'lost'] as const;
export type BattleStatus = (typeof BATTLE_STATUSES)[number];
