import type { BattleEvent, BattleEventType } from '@domain/events/battle-events';

/**
 * 动画预设表。
 *
 * 一个领域事件对应一段界面动画：名字、时长、以及挂在应用外壳上的 data 标记。
 * 事件本身不带任何表现信息（领域不该知道「发光」长什么样），映射关系归界面管。
 *
 * 关键约束：时长只影响观感。关掉动画时这些毫秒全部作废，直接落到终态。
 */

export type AnimationName =
  | 'battle-in'
  | 'cards-drawn'
  | 'cards-discarded'
  | 'weapon-equipped'
  | 'cards-played'
  | 'morale-pulse'
  | 'effect-flash'
  | 'gold-tick'
  | 'damage-tick'
  | 'deck-reshuffle'
  | 'battle-won'
  | 'battle-lost';

export interface AnimationPreset {
  readonly name: AnimationName;
  readonly duration: number;
  /** 播放期间挂在外壳 data-anim 上的标记，CSS 用它触发对应光效。 */
  readonly mark: string;
  /** 给玩家看的短标签，跳过按钮旁边会显示当前在播什么。 */
  readonly label: string;
}

const PRESET_TABLE: Readonly<Record<BattleEventType, AnimationPreset>> = {
  BattleStarted: { name: 'battle-in', duration: 260, mark: 'battle-in', label: '列阵' },
  CardsDrawn: { name: 'cards-drawn', duration: 200, mark: 'cards-drawn', label: '摸牌' },
  CardsDiscarded: { name: 'cards-discarded', duration: 220, mark: 'cards-discarded', label: '弃牌' },
  WeaponEquipped: { name: 'weapon-equipped', duration: 320, mark: 'weapon-equipped', label: '配属' },
  CardsPlayed: { name: 'cards-played', duration: 260, mark: 'cards-played', label: '出战' },
  MoraleGained: { name: 'morale-pulse', duration: 160, mark: 'morale-pulse', label: '军势' },
  EffectResolved: { name: 'effect-flash', duration: 140, mark: 'effect-flash', label: '效果' },
  GoldGained: { name: 'gold-tick', duration: 180, mark: 'gold-tick', label: '得金' },
  DamageResolved: { name: 'damage-tick', duration: 420, mark: 'damage-tick', label: '结算' },
  DeckReshuffled: { name: 'deck-reshuffle', duration: 200, mark: 'deck-reshuffle', label: '洗牌' },
  BattleWon: { name: 'battle-won', duration: 320, mark: 'battle-won', label: '得胜' },
  BattleLost: { name: 'battle-lost', duration: 320, mark: 'battle-lost', label: '败走' },
};

export function presetFor(event: BattleEvent): AnimationPreset {
  return PRESET_TABLE[event.type];
}

export function allPresetNames(): readonly AnimationName[] {
  return Object.values(PRESET_TABLE).map((preset) => preset.name);
}
