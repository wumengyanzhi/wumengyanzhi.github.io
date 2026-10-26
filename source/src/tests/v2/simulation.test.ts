import { describe, expect, it } from 'vitest';
import { DECKS } from '../../v2/data';
import { simulateRun, summarizeRuns } from '../../v2/simulation';
describe('V2 actual-engine simulations', () => {
  it('replays a seed deterministically to a legal terminal without errors', () => {
    const input = { deckId: DECKS[0]!.id, seed: 'six-battle-validation', policy: 'matching' as const };
    const first = simulateRun(input);
    const second = simulateRun(input);
    expect(first.status).toBe('completed');
    expect(['won', 'lost']).toContain(first.state.phase);
    expect(first.state).toEqual(second.state);
    expect(first.commands).toEqual(second.commands);
    expect(first.state.battles.length).toBeGreaterThan(0);
    expect(first.state.gold).toBeGreaterThanOrEqual(0);
  });
  it('separates execution errors and duplicate seeds from normal win/loss denominators', () => {
    const normal = simulateRun({ deckId: DECKS[1]!.id, seed: 'denominator', policy: 'matching' });
    const error = { ...normal, seed: 'bad', status: 'error' as const, error: 'injected' };
    const result = summarizeRuns([normal, normal, error]);
    expect(result.total).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.wins + result.losses).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.stages).toHaveLength(18);
  });
  it('keeps baseline and enhanced economy samples distinct when their game seed matches', () => {
    const normal = simulateRun({ deckId: DECKS[0]!.id, seed: 'economy-sample-key', policy: 'matching' });
    expect(summarizeRuns([normal, { ...normal, economy: 'build-aware' as const }]).total).toBe(2);
  });
  it('runs paid economy decisions through legal commands and keeps the gold ledger balanced', () => {
    const input = { deckId: DECKS[0]!.id, seed: 'economy-natural-validation', policy: 'growth' as const, economy: 'build-aware' as const };
    const result = simulateRun(input);
    expect(result.status).toBe('completed');
    expect(result.commands.some(c => ['rerollEnhancement','buyCharm','forge','upgradeCharm'].includes(c.type))).toBe(true);
    expect(result.state.gold).toBe(result.state.log.reduce((sum,l) => sum+l.goldDelta,0));
    expect(result.state.gold).toBeGreaterThanOrEqual(0);
  }, 20000);
});
