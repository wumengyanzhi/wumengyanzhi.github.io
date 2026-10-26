/** Mobile V2 is a separately versioned ruleset; legacy saves remain readable by the legacy entry. */
export type CardType = 'character' | 'weapon' | 'tactic';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Profession = 'warrior' | 'archer' | 'mage' | 'assassin' | 'guardian';
export type WeaponClass = 'blade' | 'spear' | 'bow' | 'focus' | 'hidden';
export type Faction = 'shu' | 'wei' | 'wu' | 'qun';
export interface CardDef {
  id: string; name: string; type: CardType; rarity: Rarity; power: number; amp: number;
  faction?: Faction; profession?: Profession; weaponClass?: WeaponClass;
  direction?: 'power' | 'amp'; skill: string; text: string; glyph: string;
}
export interface DeckDef { id: string; name: string; subtitle: string; description: string; cards: string[]; leaders: string[]; charm: string; color: string; }
export interface CharmDef { id: string; name: string; text: string; price: number; starter: boolean; glyph: string; }
export interface EnemyDef { id: string; name: string; hp: number; kind: 'normal' | 'elite' | 'boss'; rule: string; text: string; act: number; glyph: string; }
export interface CardInstance {
  id: string; definitionId: string; permanentPower: number; permanentAmp: number;
  temporaryPower: number; temporaryAmp: number; used: string[]; plays: number;
  chain: boolean; enhancementSkills: string[]; growthRemainder: number;
}
export interface CharmInstance { id: string; definitionId: string; acquiredPrice: number; tier?: 1 | 2 | 3; }
export interface BattleState {
  enemyId: string; hp: number; maxHp: number; playsLeft: number; discardsLeft: number;
  hand: string[]; draw: string[]; discard: string[]; slots: (string | null)[];
  equipment: Record<string, string>; targets: Record<string, string>;
  morale: number; moraleTier: 'none' | 'formed' | 'array'; activeDiscards: number;
  discardedTypes: CardType[]; completedPlays: number; used: string[];
  swallow: { sourceId: string; targetId: string; power: number }[];
}
export interface Breakdown { label: string; power: number; amp: number; kind: 'cards' | 'equipment' | 'morale' | 'skill' | 'enemy' | 'charm'; multiplier?: number; }
export interface BattleReport { power: number; amp: number; damage: number; actualDamage: number; overflow: number; sources: Breakdown[]; notes: string[]; playedIds: string[]; }
export interface BattleChoice { key: string; label: string; options: { id: string; label: string }[]; optional: boolean; }
export interface BattlePreview { report: BattleReport | null; choices: BattleChoice[]; error: string | null; }
export interface CardReward { id: string; first: boolean; candidates: string[]; }
export type EnhancementSkill = 'xian_deng' | 'zhen_jun' | 'tong_dao' | 'gu_feng' | 'jun_xu' | 'hui_xiang';
export interface EnhanceOption { id: string; targetId: string; targetIds?: string[]; tier: 'common' | 'rare' | 'legendary'; stat: 'power' | 'amp'; amount: number; skill: EnhancementSkill | null; }
export interface CharmRewardOption { id: string; definitionId: string; tier: 1 | 2 | 3; kind: 'gain' | 'upgrade'; targetId?: string; }
export interface CharmReward { id: string; kind: 'milestone' | 'boss'; candidates: CharmRewardOption[]; baseAmp: number; routeAtVictory: string | null; }
export interface MarketItem { id: string; definitionId: string; sold: boolean; }
export interface MarketState { id: string; items: MarketItem[]; rerolls: number; forged: boolean; removed: boolean; upgraded?: boolean; }
export interface GameLog { id: string; kind: string; text: string; goldDelta: number; battleIndex: number; }
export interface BattleRecord { index: number; enemyId: string; won: boolean; plays: number; discards: number; reports: BattleReport[]; remainingHp: number; }
export type Phase = 'battle' | 'cardReward' | 'enhanceReward' | 'charmReward' | 'market' | 'camp' | 'won' | 'lost';
export type RngStream = 'draw' | 'reward' | 'enhancement' | 'market';
export interface RunState {
  version: 2; ruleset: 'mobile_v2'; contentVersion: string; seed: string; runId: string;
  rng: Record<RngStream, number>; revision: number; receipts: string[];
  deckId: string; difficulty: 'standard' | 'elite'; leaderId: string | null;
  phase: Phase; battleIndex: number; cards: Record<string, CardInstance>;
  owned: string[]; removed: string[]; charms: (CharmInstance | null)[]; gold: number;
  battle: BattleState | null; reward: CardReward | null; enhancements: EnhanceOption[];
  enhancementRerolls: number; market: MarketState | null; marketVisits: number;
  removalsBought: number; log: GameLog[]; battles: BattleRecord[]; nextId: number;
  currentReports: BattleReport[];
  baseAmp?: number; charmReward?: CharmReward | null;
}
export type GameAction =
  | { type: 'stage'; cardId: string; slot: number }
  | { type: 'unstage'; slot: number; beforeId?: string | null }
  | { type: 'reorderHand'; cardId: string; beforeId: string | null }
  | { type: 'recallAll' }
  | { type: 'equip'; weaponId: string; targetId: string }
  | { type: 'target'; key: string; targetId: string }
  | { type: 'play' }
  | { type: 'discard'; cardIds: string[] }
  | { type: 'chooseCard'; definitionId: string | null; replaceId?: string }
  | { type: 'chooseEnhancement'; optionId: string; cardId?: string }
  | { type: 'chooseCharmReward'; optionId: string | null; slot?: number }
  | { type: 'upgradeCharm'; slot: number }
  | { type: 'rerollEnhancement' }
  | { type: 'buyCharm'; itemId: string; slot: number }
  | { type: 'sellCharm'; slot: number }
  | { type: 'moveCharm'; from: number; to: number }
  | { type: 'rerollMarket' }
  | { type: 'forge'; cardId: string; stat: 'power' | 'amp' }
  | { type: 'removeCard'; cardId: string }
  | { type: 'leaveMarket' }
  | { type: 'setLeader'; cardId: string }
  | { type: 'nextBattle' };
export interface ActionResult { ok: boolean; state: RunState; error: string | null; }
export class RuleError extends Error { constructor(message: string) { super(message); this.name = 'RuleError'; } }
export function cloneRun(state: RunState): RunState { return structuredClone(state); }
