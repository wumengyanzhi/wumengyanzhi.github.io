export interface HandAnchors { ids: (string | null)[]; hand: string[]; epoch: string; }

/** A returned card can have a different engine order from its restored display seat. */
export function reorderHandAnchors(previous: HandAnchors, cardId: string, beforeId: string | null, nextHand: string[]): HandAnchors {
  const visible = previous.ids.filter((id): id is string => !!id && previous.hand.includes(id) && id !== cardId);
  const at = beforeId === null ? -1 : visible.indexOf(beforeId);
  visible.splice(at < 0 ? visible.length : at, 0, cardId);
  let cursor = 0;
  const ids = previous.ids.map(id => id && previous.hand.includes(id) ? visible[cursor++]! : id);
  return { ...previous, ids, hand: [...nextHand] };
}

/** Display seats only: staged shadows never become cards in the engine's hand. */
export function reconcileHandAnchors(previous: HandAnchors | null, hand: string[], slots: (string | null)[], epoch: string): HandAnchors {
  const staged = slots.filter((id): id is string => !!id);
  if (!previous || previous.epoch !== epoch) {
    const ids: (string | null)[] = [...hand, ...staged.filter(id => !hand.includes(id))].slice(0, Math.max(8, hand.length));
    while (ids.length < 8) ids.push(null);
    return { ids, hand: [...hand], epoch };
  }
  const present = new Set([...hand, ...staged]);
  const ids = previous.ids.map(id => id && present.has(id) ? id : null);
  const isReorder = hand.length === previous.hand.length && hand.every(id => previous.hand.includes(id)) && hand.some((id, index) => id !== previous.hand[index]);
  if (isReorder) {
    let cursor = 0;
    for (let index = 0; index < ids.length; index++) if (ids[index] && hand.includes(ids[index]!)) ids[index] = hand[cursor++]!;
  }
  for (const id of [...hand, ...staged]) {
    if (ids.includes(id)) continue;
    const empty = ids.indexOf(null);
    if (empty >= 0) ids[empty] = id;
    else if (hand.includes(id)) ids.push(id);
  }
  return { ids, hand: [...hand], epoch };
}
