import { describe, expect, it } from 'vitest';
import { reconcileHandAnchors, reorderHandAnchors } from '../../v2/ui/hand-anchors';

describe('stable hand seats', () => {
  const start = () => reconcileHandAnchors(null, ['a', 'b', 'c'], [], '0');
  it('keeps staged and returned cards in their original seats', () => {
    const before = start();
    const staged = reconcileHandAnchors(before, ['a', 'c'], ['b'], '0');
    expect(staged.ids).toEqual(before.ids);
    const returned = reconcileHandAnchors(staged, ['a', 'c', 'b'], [], '0');
    expect(returned.ids).toEqual(before.ids);
    expect(reconcileHandAnchors(returned, ['a', 'c', 'b'], [], '0').ids).toEqual(before.ids);
  });
  it('reorders only the real hand seats around staged shadows', () => {
    const staged = reconcileHandAnchors(start(), ['a', 'c'], ['b'], '0');
    expect(reconcileHandAnchors(staged, ['c', 'a'], ['b'], '0').ids.slice(0, 3)).toEqual(['c', 'b', 'a']);
  });
  it('uses visible order when dragging a returned card, even if the engine order is different', () => {
    const staged = reconcileHandAnchors(start(), ['a', 'c'], ['b'], '0');
    const returned = reconcileHandAnchors(staged, ['a', 'c', 'b'], [], '0');
    const reordered = reorderHandAnchors(returned, 'a', 'c', ['a', 'c', 'b']);
    expect(reordered.ids.slice(0, 3)).toEqual(['b', 'a', 'c']);
    expect(reconcileHandAnchors(reordered, ['a', 'c', 'b'], [], '0').ids).toEqual(reordered.ids);
  });
  it('repacks on draw/discard and always retains eight display anchors', () => {
    const after = reconcileHandAnchors(start(), ['d', 'e'], [], '1');
    expect(after.ids).toEqual(['d', 'e', null, null, null, null, null, null]);
    expect(reconcileHandAnchors(null, ['a'], ['b'], '0').ids.slice(0, 2)).toEqual(['a', 'b']);
  });
  it('does not drop real cards when resuming an unusual fixture with eight hand and filled slots', () => {
    const hand = Array.from({ length: 8 }, (_, i) => `hand-${i}`);
    expect(reconcileHandAnchors(null, hand, ['staged'], '0').ids.filter(id => hand.includes(id!))).toEqual(hand);
  });
});
