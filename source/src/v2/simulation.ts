import { act, createRun, validLeaders } from './engine';
import { CARD_MAP, CHARM_MAP, DECKS, MATCH_MATRIX } from './data';
import { getBattleChoices, previewBattle } from './battle';
import { cloneRun } from './model';
import type { CardType, GameAction, RunState } from './model';
import { charmTier, forgeTerms, isRouteCharm, upgradeTerms } from './campaign';
import { economyDecision } from './simulation-economy';

export type AutoPolicy = 'matching' | 'growth';
export interface SimulationInput { deckId: string; seed: string; policy: AutoPolicy; difficulty?: 'standard' | 'elite'; economy?: 'build-aware'; }
export interface SimulationResult { seed: string; deckId: string; policy: AutoPolicy; economy?: 'build-aware'; status: 'completed' | 'error' | 'budget_exceeded'; error: string | null; state: RunState; commands: GameAction[]; }
const value = (s: RunState, id: string) => { const c = s.cards[id]!, d = CARD_MAP[c.definitionId]!; return d.power + c.permanentPower + (d.amp + c.permanentAmp) * 20; };
function automaticTargets(s: RunState): void {
  const b = s.battle!;
  // Equipment choices precede skills; resolve again after weapons have legal owners.
  for (let round = 0; round < 2; round++) for (const choice of getBattleChoices(s)) {
    if (choice.key.startsWith('equip:')) {
      const weaponId = choice.key.slice(6), weapon = CARD_MAP[s.cards[weaponId]!.definitionId]!;
      const best = [...choice.options].sort((a, z) => {
        const da = CARD_MAP[s.cards[a.id]!.definitionId]!, dz = CARD_MAP[s.cards[z.id]!.definitionId]!;
        return MATCH_MATRIX[dz.profession!][weapon.weaponClass!] - MATCH_MATRIX[da.profession!][weapon.weaponClass!];
      })[0];
      if (best) b.equipment[weaponId] = best.id;
    } else {
      const best = [...choice.options].sort((a, z) => value(s, z.id) - value(s, a.id))[0];
      if (best) b.targets[choice.key] = best.id;
    }
  }
}
type SlotPattern = (CardType | null)[];
const PATTERNS: SlotPattern[] = [
  ['character','weapon','character','weapon','tactic'],
  ['weapon','character','weapon','tactic','tactic'],
  ['character','tactic','tactic','weapon','character'],
  ['character','weapon','character','weapon','character'],
  ['character','weapon','tactic','weapon','character'],
  ['tactic','character','weapon','character','weapon'],
  ['character','weapon',null,'weapon','character'],
  ['character','tactic',null,'tactic','character'],
  ['tactic',null,'weapon','character','weapon'],
];
/** Finite public-state search, max 256 formations. Not an optimal or human policy. */
export function planBattle(s: RunState, policy: AutoPolicy): GameAction[] {
  const b = s.battle!;
  const all = [...b.hand, ...b.slots.filter((x): x is string => x !== null)];
  const groups: Record<CardType, string[]> = { character: [], weapon: [], tactic: [] };
  for (const id of all) groups[CARD_MAP[s.cards[id]!.definitionId]!.type].push(id);
  for (const group of Object.values(groups)) group.sort((a, z) => value(s, z) - value(s, a) || a.localeCompare(z));
  let best: RunState | null = null, bestScore = -Infinity;
  const evaluate = (slots: (string | null)[]) => {
    const copy = cloneRun(s), cb = copy.battle!;
    cb.slots = [...slots]; cb.hand = all.filter(id => !slots.includes(id)); cb.equipment = {}; cb.targets = {};
    automaticTargets(copy);
    const p = previewBattle(copy).report;
    if (!p) return;
    let score = Math.min(b.hp, p.damage) + p.damage * 0.015;
    if (p.damage >= b.hp) score += 100000;
    if (policy === 'growth') for (const id of slots) {
      if (id && ['xia_hou_dun','zhu_ge_liang','zhen_jun_yi_dao'].includes(CARD_MAP[s.cards[id]!.definitionId]!.skill)) score += 35;
    }
    if (score > bestScore) { best = copy; bestScore = score; }
  };
  // Reserve one-card and current formation candidates even when templates do not fit.
  for (const id of all) evaluate([id, null, null, null, null]);
  if (b.slots.some(Boolean)) evaluate(b.slots);
  for (const pattern of PATTERNS) {
    let generated = 0;
    const fill = (position: number, slots: (string | null)[]) => {
      if (generated >= 28) return;
      if (position === 5) { generated++; evaluate(slots); return; }
      const type = pattern[position];
      if (type === null || type === undefined) { fill(position + 1, [...slots, null]); return; }
      const options = groups[type].filter(id => !slots.includes(id));
      if (!options.length) { fill(position + 1, [...slots, null]); return; }
      for (const id of options) { fill(position + 1, [...slots, id]); if (generated >= 28) break; }
    };
    fill(0, []);
  }
  if (!best) return [];
  const chosen = best as RunState;
  const commands: GameAction[] = b.slots.flatMap((id, slot) => id ? [{ type: 'unstage' as const, slot }] : []);
  chosen.battle!.slots.forEach((id, slot) => { if (id) commands.push({ type: 'stage', cardId: id, slot }); });
  for (const [weaponId, targetId] of Object.entries(chosen.battle!.equipment)) commands.push({ type: 'equip', weaponId, targetId });
  for (const [key, targetId] of Object.entries(chosen.battle!.targets)) commands.push({ type: 'target', key, targetId });
  commands.push({ type: 'play' });
  return commands;
}
export function simulateRun(input: SimulationInput): SimulationResult {
  const deck = DECKS.find(d => d.id === input.deckId);
  if (!deck) throw new Error('起始牌组不存在');
  let state = createRun(deck.id, deck.leaders[input.policy === 'growth' ? 0 : 1]!, input.seed, input.difficulty);
  const commands: GameAction[] = [];
  const base = () => ({ seed: input.seed, deckId: input.deckId, policy: input.policy, ...(input.economy?{economy:input.economy}:{}), state, commands });
  const commit = (command: GameAction) => {
    const result = act(state, command, `auto-${commands.length}`);
    if (!result.ok) throw new Error(result.error ?? '自动操作被拒绝');
    state = result.state; commands.push(command);
  };
  try {
    for (let step = 0; step < 1000; step++) {
      if (state.phase === 'won' || state.phase === 'lost') return { ...base(), status: 'completed', error: null };
      if (commands.length > 3000) return { ...base(), status: 'budget_exceeded', error: '超过 3000 条命令预算' };
      if(input.economy==='build-aware'){
        const action=economyDecision(state,input.policy);
        if(action){commit(action);continue;}
      }
      if (state.phase === 'battle') {
        // The discard strategy uses only the visible hand and a documented fixed threshold.
        const discardRoute=state.charms.some(c=>c?.definitionId.endsWith('zhe_jian_ling'));
        if ((input.policy === 'growth' || discardRoute) && state.battle!.activeDiscards < (discardRoute?2:1) && state.battle!.discardsLeft > 0) {
          const weak = [...state.battle!.hand].sort((a, z) => value(state, a) - value(state, z)).filter(id => id !== state.leaderId).slice(0, 3);
          if (weak.length) { commit({ type: 'discard', cardIds: weak }); continue; }
        }
        const plan = planBattle(state, input.policy);
        if (!plan.length) throw new Error('策略没有找到合法出战');
        for (const command of plan) commit(command);
      } else if (state.phase === 'cardReward') {
        const options = [...state.reward!.candidates].sort((a, z) => {
          const da = CARD_MAP[a]!, dz = CARD_MAP[z]!;
          const rank = { common: 0, rare: 1, epic: 2, legendary: 3 };
          return rank[dz.rarity] - rank[da.rarity] || dz.amp * 20 + dz.power - (da.amp * 20 + da.power);
        });
        const selected=options[0];
        const weakest=selected&&!state.reward!.first?state.owned.filter(id=>!state.removed.includes(id)&&id!==state.leaderId&&CARD_MAP[state.cards[id]!.definitionId]!.type===CARD_MAP[selected]!.type).sort((a,z)=>value(state,a)-value(state,z))[0]:undefined;
        commit({ type: 'chooseCard', definitionId: selected ?? null, ...(weakest?{replaceId:weakest}:{}) });
      } else if (state.phase === 'enhanceReward') {
        const option = [...state.enhancements].sort((a, z) => (z.stat === 'amp' ? z.amount * 20 : z.amount) - (a.stat === 'amp' ? a.amount * 20 : a.amount))[0];
        if (!option) throw new Error('没有强化候选');
        commit({ type: 'chooseEnhancement', optionId: option.id });
      } else if (state.phase === 'charmReward') {
        const preferred=deck.charm.endsWith('lian_ce_jian')?'zhou_liu_chou':deck.charm.endsWith('fu_ji_ling')?'zhe_jian_ling':'shuang_feng_jun_yin';
        const choices=state.charmReward!.candidates;
        const option=choices.find(o=>o.kind==='upgrade'&&isRouteCharm(o.definitionId))??choices.find(o=>o.definitionId.endsWith(preferred))??choices.find(o=>o.kind==='upgrade')??choices[0];
        if(!option)commit({type:'chooseCharmReward',optionId:null});
        else {
          const route=state.charms.findIndex(c=>c&&isRouteCharm(c.definitionId));
          let slot=isRouteCharm(option.definitionId)&&route>=0?route:state.charms.findIndex(c=>c===null);
          if(slot<0)slot=state.charms.findIndex(c=>c&&!isRouteCharm(c.definitionId)&&!CHARM_MAP[c.definitionId]!.starter);
          commit({type:'chooseCharmReward',optionId:option.id,...(slot>=0?{slot}:{})});
        }
      } else if (state.phase === 'market') {
        const hasRoute=state.charms.some(c=>c&&isRouteCharm(c.definitionId));
        const available = state.market!.items.filter(i => !i.sold && state.gold >= CHARM_MAP[i.definitionId]!.price&&(!hasRoute||!isRouteCharm(i.definitionId)));
        const priority: Record<string, number> = { cheng_shi_jing: 100, ju_shi_qi: 60, wen_jun_gu: 50, shuang_feng_jun_yin: 40, zhou_liu_chou: 30, zhe_jian_ling: 20 };
        available.sort((a, z) => (priority[z.definitionId.split('.').at(-1)!] ?? 0) - (priority[a.definitionId.split('.').at(-1)!] ?? 0));
        const item = available[0], empty = state.charms.findIndex(c => c === null);
        const upgrade=state.charms.map((c,slot)=>({c,slot,terms:upgradeTerms(state,slot)})).filter(x=>x.terms.allowed&&state.gold>=x.terms.cost).sort((a,z)=>Number(CHARM_MAP[z.c!.definitionId]!.starter)-Number(CHARM_MAP[a.c!.definitionId]!.starter)||charmTier(a.c!)-charmTier(z.c!))[0];
        const forgeTarget=state.owned.filter(id=>!state.removed.includes(id)&&(CARD_MAP[state.cards[id]!.definitionId]!.type==='weapon'||CARD_MAP[state.cards[id]!.definitionId]!.direction==='amp')).sort((a,z)=>value(state,z)-value(state,a))[0];
        if(upgrade)commit({type:'upgradeCharm',slot:upgrade.slot});
        else if (item && empty >= 0) commit({ type: 'buyCharm', itemId: item.id, slot: empty });
        else if (!state.market!.forged && state.gold >= forgeTerms(state).cost && forgeTarget) commit({ type: 'forge', cardId: forgeTarget, stat: 'amp' });
        else commit({ type: 'leaveMarket' });
      } else if (state.phase === 'camp') {
        if (!state.leaderId || state.removed.includes(state.leaderId)) {
          const leader = validLeaders(state)[0]; if (leader) commit({ type: 'setLeader', cardId: leader });
        }
        commit({ type: 'nextBattle' });
      }
    }
    return { ...base(), status: 'budget_exceeded', error: '超过阶段步数预算' };
  } catch (error) { return { ...base(), status: 'error', error: error instanceof Error ? error.message : '演练发生错误' }; }
}
export function summarizeRuns(input: readonly SimulationResult[]) {
  const seen = new Set<string>();
  const results = input.filter(r => { const key = `${r.seed}:${r.deckId}:${r.policy}:${r.state.difficulty}:${r.economy??'baseline'}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const completed = results.filter(r => r.status === 'completed');
  const wins = completed.filter(r => r.state.phase === 'won').length;
  return { total: results.length, completed: completed.length, wins, losses: completed.length - wins, errors: results.filter(r => r.status === 'error').length, budgets: results.filter(r => r.status === 'budget_exceeded').length, duplicates: input.length - results.length, winRate: completed.length ? wins / completed.length : null,
    stages: Array.from({ length: 18 }, (_, index) => { const reached = completed.filter(r => r.state.battles.some(b => b.index === index)); const won = reached.filter(r => r.state.battles.find(b => b.index === index)?.won); return { index, reached: reached.length, won: won.length, conditional: reached.length ? won.length / reached.length : null }; }),
  };
}
