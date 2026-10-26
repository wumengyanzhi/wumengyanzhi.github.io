import { describe, expect, it } from 'vitest';
import { act, createRun } from '../../v2/engine';
import { DECKS } from '../../v2/data';
import { parseRun, serializeRun } from '../../v2/persistence';
const fresh = () => createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'card-interaction');
describe('reversible formation commands', () => {
  it('reorders a hand card before another and persists without spending resources or RNG', () => {
    const state = fresh(), before = state.battle!.hand;
    const result = act(state, { type: 'reorderHand', cardId: before[3]!, beforeId: before[0]! });
    expect(result.ok).toBe(true);
    expect(result.state.battle!.hand).toEqual([before[3], ...before.filter(id => id !== before[3])]);
    expect(result.state.rng).toEqual(state.rng);
    expect(result.state.battle!.playsLeft).toBe(4);
    expect(parseRun(serializeRun(result.state)).battle!.hand).toEqual(result.state.battle!.hand);
  });
  it('rejects invalid hand-order targets without changing state', () => {
    const state = fresh();
    const result = act(state, { type: 'reorderHand', cardId: state.battle!.hand[0]!, beforeId: 'missing' });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
  });
  it('returns a staged card to the exact hand insertion point', () => {
    let state = fresh();
    const card = state.battle!.hand[0]!;
    state = act(state, { type: 'stage', cardId: card, slot: 2 }).state;
    const target = state.battle!.hand[1]!;
    const result = act(state, { type: 'unstage', slot: 2, beforeId: target });
    expect(result.ok).toBe(true);
    expect(result.state.battle!.hand.indexOf(card)).toBe(1);
    expect(result.state.battle!.slots[2]).toBe(null);
    expect(new Set(result.state.battle!.hand).size).toBe(8);
  });
  it('recalls all five slots as one atomic command and clears equipment intent', () => {
    let state = fresh();
    for (let slot = 0; slot < 5; slot++) state = act(state, { type: 'stage', cardId: state.battle!.hand[0]!, slot }).state;
    const result = act(state, { type: 'recallAll' });
    expect(result.ok).toBe(true);
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.battle!.slots).toEqual([null, null, null, null, null]);
    expect(result.state.battle!.hand).toHaveLength(8);
    expect(result.state.battle!.equipment).toEqual({});
    expect(result.state.battle!.targets).toEqual({});
    expect(result.state.rng).toEqual(state.rng);
    expect(result.state.battle!.discardsLeft).toBe(3);
  });
});
