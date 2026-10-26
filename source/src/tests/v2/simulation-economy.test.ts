import { describe, expect, it } from 'vitest';
import { CARD_MAP, DECKS } from '../../v2/data';
import { act, createRun } from '../../v2/engine';
import { enhancementForCard } from '../../v2/campaign-rewards';
import { economyDecision } from '../../v2/simulation-economy';
import type { GameAction, RunState } from '../../v2/model';

const charm = (name: string, tier: 1|2|3 = 1) => ({ id: `test-${name}`, definitionId: `three_kingdoms.charm.${name}`, acquiredPrice: 4, tier });
function market(gold = 10): RunState {
  const s = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'economy-unit');
  s.phase = 'market'; s.battle = null; s.battleIndex = 1; s.gold = gold;
  s.market = { id: 'test-shop', items: [], forged: false, removed: false, upgraded: false, rerolls: 0 };
  return s;
}
function commit(s: RunState, a: GameAction | null): RunState {
  expect(a).not.toBeNull();
  const next = act(s, a!); expect(next.error).toBeNull(); expect(next.ok).toBe(true); return next.state;
}
function weakEnhancements(s: RunState): void {
  s.phase = 'enhanceReward'; s.market = null;
  const weak = s.owned.filter(id => CARD_MAP[s.cards[id]!.definitionId]!.rarity === 'common' && CARD_MAP[s.cards[id]!.definitionId]!.type === 'character').slice(0, 3);
  s.enhancements = weak.map((targetId, i) => ({ ...enhancementForCard(s, targetId), id: `option-${i}` }));
}

describe('optional build-aware simulation economy', () => {
  it('buys a useful affordable charm through the real command and pays its price', () => {
    const s = market(4); s.market!.forged = true;
    s.market!.items = [{ id: 'offer', definitionId: charm('ju_shi_qi').definitionId, sold: false }];
    const action = economyDecision(s, 'growth'); expect(action?.type).toBe('buyCharm');
    const next = commit(s, action); expect(next.gold).toBe(0); expect(next.charms.some(c => c?.definitionId.endsWith('ju_shi_qi'))).toBe(true);
  });
  it('never buys, rerolls, removes or forges with no gold', () => {
    const s = market(0); s.market!.items = [{ id: 'expensive', definitionId: charm('cheng_shi_jing').definitionId, sold: false }];
    expect(economyDecision(s, 'matching')).toEqual({ type: 'leaveMarket' });
  });
  it('can exchange a full charm inventory when the new charm is useful and affordable with resale', () => {
    const s = market(4); s.market!.forged = true;
    s.charms = [charm('cui_bing_fu'), charm('lian_ce_jian'), charm('wen_jun_gu')];
    s.market!.items = [{ id: 'better', definitionId: charm('ju_shi_qi').definitionId, sold: false }];
    const action = economyDecision(s, 'matching'); expect(action?.type).toBe('buyCharm');
    const next = commit(s, action); expect(next.charms.filter(Boolean)).toHaveLength(3); expect(next.gold).toBeGreaterThanOrEqual(0);
  });
  it('upgrades an unlocked charm and pays once per store', () => {
    const s = market(4); s.market!.forged = true; s.battleIndex = 7;
    s.battles = [{ index: 5, enemyId: 'fixture', won: true, plays: 3, discards: 1, reports: [], remainingHp: 0 }];
    const action = economyDecision(s, 'growth'); expect(action).toEqual({ type: 'upgradeCharm', slot: 0 });
    const next = commit(s, action); expect(next.charms[0]?.tier).toBe(2); expect(next.gold).toBe(0); expect(next.market?.upgraded).toBe(true);
  });
  it('uses actual forge limits and a legal power or amp target', () => {
    const s = market(3);
    const action = economyDecision(s, 'growth'); expect(action?.type).toBe('forge');
    const next = commit(s, action); expect(next.gold).toBe(0); expect(next.market?.forged).toBe(true);
  });
  it('rerolls poor random enhancement targets using real gold and RNG', () => {
    const s = market(15); weakEnhancements(s); const before = structuredClone(s);
    const action = economyDecision(s, 'growth'); expect(action).toEqual({ type: 'rerollEnhancement' });
    expect(s).toEqual(before);
    const next = commit(s, action); expect(next.gold).toBe(13); expect(next.enhancementRerolls).toBe(1); expect(next.rng.enhancement).not.toBe(s.rng.enhancement);
  });
  it('takes the best available free option when reroll budget is exhausted or unaffordable', () => {
    for (const [gold, rerolls] of [[0, 0], [100, 2]] as const) {
      const s = market(gold); weakEnhancements(s); s.enhancementRerolls = rerolls;
      const action = economyDecision(s, 'growth'); expect(action?.type).toBe('chooseEnhancement'); commit(s, action);
    }
  });
  it('does not spend the imminent shop forge reserve on enhancement rerolls', () => {
    const s = market(4); weakEnhancements(s);
    expect(economyDecision(s, 'growth')?.type).toBe('chooseEnhancement');
  });
  it('keeps permanently strengthened cards instead of replacing them by rarity alone', () => {
    const s = market(10); s.phase = 'cardReward'; s.market = null;
    for (const c of Object.values(s.cards)) if (CARD_MAP[c.definitionId]!.type === 'character') c.permanentPower = 200;
    s.reward = { id: 'reward', first: false, candidates: ['three_kingdoms.character.guan_yu'] };
    expect(economyDecision(s, 'growth')).toEqual({ type: 'chooseCard', definitionId: null });
  });
  it('puts amp additions before multipliers and finishes without reorder loops', () => {
    let s = market(); s.phase = 'camp'; s.market = null;
    s.charms = [charm('shuang_feng_jun_yin', 2), charm('ju_shi_qi'), charm('cui_bing_fu')];
    let moves = 0;
    for (let i = 0; i < 5; i++) {
      const action = economyDecision(s, 'growth'); if (!action) break;
      expect(action.type).toBe('moveCharm'); s = commit(s, action); moves++;
    }
    expect(moves).toBeGreaterThan(0); expect(moves).toBeLessThan(4);
    expect(s.charms[2]?.definitionId).toBe(charm('shuang_feng_jun_yin').definitionId);
    expect(economyDecision(s, 'growth')).toBeNull();
  });
  it('does not inspect future random streams when making a public shop decision', () => {
    const s = market(4); s.market!.forged = true;
    s.market!.items = [{ id: 'offer', definitionId: charm('ju_shi_qi').definitionId, sold: false }];
    Object.defineProperty(s, 'rng', { get: () => { throw new Error('hidden random stream read'); } });
    expect(() => economyDecision(s, 'growth')).not.toThrow(); expect(economyDecision(s, 'growth')?.type).toBe('buyCharm');
  });
});
