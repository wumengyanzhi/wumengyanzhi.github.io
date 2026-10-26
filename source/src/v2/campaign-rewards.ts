import { CARD_MAP, CHARMS } from './data';
import { chapterIndex, charmTier, isRouteCharm, maxCharmTier, ROUTE_CHARMS } from './campaign';
import type { CharmRewardOption, EnhanceOption, RunState } from './model';
import { sample } from './rng';

export const nextId = (s: RunState, prefix: string): string => `${prefix}-${s.nextId++}`;
export const activeCards = (s: RunState): string[] => s.owned.filter(id => !s.removed.includes(id));
export function legalStat(s: RunState, cardId: string, stat: 'power'|'amp'): boolean {
  const d = CARD_MAP[s.cards[cardId]?.definitionId ?? ''];
  return !!d && (stat === 'power' || stat === 'amp') && (d.type === 'weapon' || (d.type === 'character' ? stat === 'power' : d.direction === stat));
}
/** v0.4.0 grouped rewards are retained only to validate pending saves before migration. */
export function enhancementGroups(s: RunState): Omit<EnhanceOption,'id'>[] {
  const ids = activeCards(s), n = chapterIndex(s) + 1;
  const groups: { ids: string[]; stat: 'power'|'amp' }[] = [
    { ids: ids.filter(id => CARD_MAP[s.cards[id]!.definitionId]!.type === 'weapon'), stat: 'amp' },
    { ids: ids.filter(id => { const d = CARD_MAP[s.cards[id]!.definitionId]!; return d.type === 'tactic' && d.direction === 'amp'; }), stat: 'amp' },
    { ids: ids.filter(id => CARD_MAP[s.cards[id]!.definitionId]!.type === 'character'), stat: 'power' },
  ];
  if (groups.every(g => g.ids.length === 0)) groups.push({ ids: ids.filter(id => legalStat(s,id,'power')), stat: 'power' });
  return groups.filter(g => g.ids.length).map(g => ({ targetId: g.ids[0]!, targetIds: g.ids, tier: 'common', stat: g.stat, amount: n * (g.stat === 'power' ? 10 : 1), skill: null }));
}
type CharmChoice = Omit<CharmRewardOption,'id'>;
/** Pure candidate generation; saved choices can be validated without consuming RNG. */
export function eligibleCharmChoices(s: RunState, kind: 'milestone'|'boss'): CharmChoice[] {
  const route = s.charms.find(c => c && isRouteCharm(c.definitionId));
  if (kind === 'boss') return ROUTE_CHARMS.map(definitionId => {
    if (route?.definitionId === definitionId) return { definitionId, tier: Math.min(3,charmTier(route)+1) as 1|2|3, kind: 'upgrade', targetId: route.id };
    return { definitionId, tier: s.battleIndex === 5 && route ? 1 : 2, kind: 'gain' };
  });
  const cap = maxCharmTier(s), out: CharmChoice[] = [];
  const add = (choice: CharmChoice) => { if (out.length < 3 && !out.some(x => x.definitionId === choice.definitionId)) out.push(choice); };
  const upgrades = s.charms.filter(c => c && charmTier(c) < cap).sort((a,b) => Number(isRouteCharm(b!.definitionId))-Number(isRouteCharm(a!.definitionId)));
  const gains = CHARMS.filter(d => !d.starter && !s.charms.some(c => c?.definitionId === d.id));
  if (chapterIndex(s) === 0) {
    for (const definitionId of ROUTE_CHARMS) {
      if (!s.charms.some(c => c?.definitionId === definitionId)) add({ definitionId, tier: 1, kind: 'gain' });
      else {
        const fallback = gains.find(d => !isRouteCharm(d.id) && !out.some(x => x.definitionId === d.id));
        if (fallback) add({ definitionId: fallback.id, tier: 1, kind: 'gain' });
      }
    }
  } else {
    for (const c of upgrades) add({ definitionId: c!.definitionId, tier: (charmTier(c!)+1) as 2|3, kind: 'upgrade', targetId: c!.id });
    for (const d of gains.filter(d => !isRouteCharm(d.id))) add({ definitionId: d.id, tier: 1, kind: 'gain' });
    for (const d of gains) add({ definitionId: d.id, tier: 1, kind: 'gain' });
  }
  return out;
}
export function enhancementForCard(s: RunState, targetId: string): Omit<EnhanceOption,'id'> {
  const d=CARD_MAP[s.cards[targetId]!.definitionId]!;
  const stat=d.type==='character'||d.direction==='power'?'power':'amp';
  return {targetId,tier:'common',stat,amount:(chapterIndex(s)+1)*(stat==='power'?10:1),skill:null};
}
export const enhancementRerollCost = (s: RunState): number => 2+s.enhancementRerolls;
export function rollEnhancements(s: RunState): EnhanceOption[] {
  const pool=activeCards(s),targets=sample(s,'enhancement',pool,3),previous=new Set(s.enhancements.map(o=>o.targetId));
  // A paid reroll must change at least one choice whenever other targets exist.
  if(pool.length>targets.length&&targets.every(id=>previous.has(id))){
    targets[targets.length-1]=sample(s,'enhancement',pool.filter(id=>!targets.includes(id)),1)[0]!;
  }
  return targets.map(targetId=>({...enhancementForCard(s,targetId),id:nextId(s,'enhance')}));
}
export function createEnhancements(s: RunState): void {
  s.enhancements = rollEnhancements(s);
  s.enhancementRerolls = 0;
  s.phase = 'enhanceReward';
}
export function createCharmReward(s: RunState, kind: 'milestone'|'boss'): void {
  const route = s.charms.find(c => c && isRouteCharm(c.definitionId));
  s.charmReward = { id: nextId(s,'reward'), kind, candidates: eligibleCharmChoices(s,kind).map(c => ({ ...c, id: nextId(s,'item') })), baseAmp: kind === 'boss' ? s.battleIndex === 5 ? 4 : 6 : 0, routeAtVictory: route?.id ?? null };
  s.phase = 'charmReward';
}
