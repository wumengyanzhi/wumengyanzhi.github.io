import { CHARM_MAP, ENEMIES } from './data';
import { CHARM_MAP as OLD_CHARMS, ENEMIES as OLD_ENEMIES } from './legacy/data';
import type { CharmDef, CharmInstance, EnemyDef, RunState } from './model';

export const CAMPAIGN_CONTENT_VERSION = 'mobile-v2-campaign-2026-10-20';
export const LEGACY_CONTENT_VERSION = 'mobile-v2-2026-10-17';
export const ROUTE_CHARMS = ['shuang_feng_jun_yin','zhou_liu_chou','zhe_jian_ling'].map(id => `three_kingdoms.charm.${id}`);
export const isCampaign = (s: RunState): boolean => s.contentVersion === CAMPAIGN_CONTENT_VERSION;
export const enemiesFor = (s?: RunState | null): readonly EnemyDef[] => s && !isCampaign(s) ? OLD_ENEMIES : ENEMIES;
export const chapterIndex = (s: RunState): number => Math.min(2, Math.floor(s.battleIndex / 6));
export const charmTier = (c: CharmInstance): 1 | 2 | 3 => c.tier ?? 1;
export const isRouteCharm = (id: string): boolean => ROUTE_CHARMS.includes(id);
export const resaleValue = (c: CharmInstance): number => Math.max(1, Math.floor(c.acquiredPrice / 2));
export function maxCharmTier(s: RunState): 1 | 2 | 3 {
  return s.battles.some(b => b.index === 11 && b.won) ? 3 : s.battles.some(b => b.index === 5 && b.won) ? 2 : 1;
}
export function positionLabel(s: RunState, index = s.battleIndex): string {
  return isCampaign(s) ? `第${Math.floor(index / 6) + 1}大关 · 第${index % 6 + 1}/6局` : `第${index + 1}/6战`;
}
export function forgeTerms(s: RunState): { cost: number; power: number; amp: number } {
  const n = isCampaign(s) ? chapterIndex(s) + 1 : 1;
  return { cost: n + 2, power: n * 20, amp: n * 2 };
}
export function upgradeTerms(s: RunState, slot: number): { allowed: boolean; cost: number; nextTier: number } {
  const c = s.charms[slot], current = c ? charmTier(c) : 3;
  const nextTier = Math.min(3, current + 1);
  return { allowed: !!c && isCampaign(s) && s.phase === 'market' && !s.market?.upgraded && current < maxCharmTier(s), cost: nextTier === 2 ? 4 : 6, nextTier };
}

export interface CharmValues { power: number; amp: number; multiplier: readonly [number, number] }
export function charmValues(id: string, tier: number): CharmValues {
  const level = tier - 1, suffix = id.split('.').at(-1);
  const multiplier: readonly [number, number] = isRouteCharm(id) ? ([[13,10],[8,5],[2,1]] as const)[level]! : suffix === 'cheng_shi_jing' ? ([[6,5],[27,20],[3,2]] as const)[level]! : [1,1];
  const amp = ['cui_bing_fu','lian_ce_jian','fu_ji_ling'].includes(suffix ?? '') ? [2,6,10][level]! : suffix === 'ju_shi_qi' ? [3,5,7][level]! : 0;
  return { power: suffix === 'wen_jun_gu' ? [30,50,70][level]! : 0, amp, multiplier };
}
export function charmDefinition(s: RunState | null, id: string, tier?: number): CharmDef {
  if (s && !isCampaign(s)) return OLD_CHARMS[id]!;
  const d = CHARM_MAP[id]!;
  const level = tier ?? (s?.charms.find(c => c?.definitionId === id)?.tier ?? 1);
  const v = charmValues(id, level), m = v.multiplier[0] / v.multiplier[1];
  const suffix = id.split('.').at(-1);
  const text: Record<string, string> = {
    cui_bing_fu: `本次至少一组本职武器装备关系时，增幅＋${v.amp}。`,
    lian_ce_jian: `本次至少两张战术时，增幅＋${v.amp}；允许同名独立实体。`,
    fu_ji_ling: `本场至少一次主动弃牌后，增幅＋${v.amp}。`,
    ju_shi_qi: `本次增幅＋${v.amp}。`, wen_jun_gu: `本次威力＋${v.power}。`,
    shuang_feng_jun_yin: `本次有一名人物同时装备两件武器时，增幅×${m}。路线乘幅最多装备一枚。`,
    zhou_liu_chou: `本次至少两张不同名战术时，增幅×${m}。路线乘幅最多装备一枚。`,
    zhe_jian_ling: `本场至少两次主动弃牌，且本次有射手时，增幅×${m}。路线乘幅最多装备一枚。`,
    cheng_shi_jing: `军势至少5且本次至少两种卡类时，增幅×${m}。`,
  };
  return { ...d, text: text[suffix!]! };
}
