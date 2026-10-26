import type { GameAction } from '../model';
export interface Point { x: number; y: number; }
export interface DragSource { cardId: string; fromSlot: number | null; }
export type DropTarget = { kind: 'slot'; slot: number } | { kind: 'hand'; beforeId: string | null };
type Rect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;
const contains = (rect: Rect, point: Point) => rect.width > 0 && rect.height > 0 && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
const intersection = (rect: Rect, clip: Rect): Rect => {
  const left = Math.max(rect.left, clip.left), top = Math.max(rect.top, clip.top);
  const right = Math.min(rect.right, clip.right), bottom = Math.min(rect.bottom, clip.bottom);
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
};
export const dropKey = (target: DropTarget | null) => target ? target.kind === 'slot' ? `slot:${target.slot}` : `hand:${target.beforeId ?? 'end'}` : '';
export function findDropTarget(root: HTMLElement, point: Point, source: DragSource, snap: boolean): DropTarget | null {
  const viewport: Rect = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
  if (!contains(viewport, point)) return null;
  const actions = root.querySelector<HTMLElement>('.v2-battle-actions');
  if (actions && contains(actions.getBoundingClientRect(), point)) return null;
  const formation = root.querySelector<HTMLElement>('.v2-formation-scroll');
  const clip = formation ? intersection(formation.getBoundingClientRect(), viewport) : viewport;
  const withinRow = clip.width > 0 && point.x >= clip.left && point.x <= clip.right;
  const slots = withinRow ? [...root.querySelectorAll<HTMLElement>('[data-v2-slot]')].map(element => ({ index: Number(element.dataset.v2Slot), rect: intersection(element.getBoundingClientRect(), clip) })).filter(slot => slot.rect.width > 0 && slot.rect.height > 0) : [];
  const inside = slots.find(slot => contains(slot.rect, point));
  if (inside) return { kind: 'slot', slot: inside.index };
  const hand = root.querySelector<HTMLElement>('.v2-hand-scroll');
  if (hand && contains(hand.getBoundingClientRect(), point)) {
    const before = [...hand.querySelectorAll<HTMLElement>('[data-drag-card-id]')].find(card => {
      if (card.dataset.dragCardId === source.cardId) return false;
      const rect = card.getBoundingClientRect();
      return rect.width > 0 && point.x < rect.left + rect.width / 2;
    });
    return { kind: 'hand', beforeId: before?.dataset.dragCardId ?? null };
  }
  if (!snap) return null;
  let closest: { index: number; distance: number } | null = null;
  for (const slot of slots) {
    if (slot.rect.width <= 0 || slot.rect.height <= 0) continue;
    const distance = Math.hypot(Math.max(slot.rect.left - point.x, 0, point.x - slot.rect.right), Math.max(slot.rect.top - point.y, 0, point.y - slot.rect.bottom));
    if (distance <= 18 && (!closest || distance < closest.distance)) closest = { index: slot.index, distance };
  }
  return closest ? { kind: 'slot', slot: closest.index } : null;
}
export function dropAction(source: DragSource, target: DropTarget | null): GameAction | null {
  if (!target) return null;
  if (target.kind === 'slot') return source.fromSlot === target.slot ? null : { type: 'stage', cardId: source.cardId, slot: target.slot };
  return source.fromSlot === null ? { type: 'reorderHand', cardId: source.cardId, beforeId: target.beforeId } : { type: 'unstage', slot: source.fromSlot, beforeId: target.beforeId };
}
