import { act as reactAct, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameApp from '../../v2/ui/game-app';
import { act, createLegacyRun as createRun } from '../../v2/engine';
import { DECKS } from '../../v2/data';
import { parseRun, SAVE_KEY, serializeRun } from '../../v2/persistence';
import { SETTINGS_KEY } from '../../v2/ui/menu-screens';
import type { RunState } from '../../v2/model';

class TestPointerEvent extends MouseEvent {
  pointerId: number; pointerType: string; isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; this.isPrimary = init.isPrimary ?? true; }
}
function box(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const slots = [...document.querySelectorAll('[data-testid="v2-slot"]')];
    const cards = [...document.querySelectorAll('[data-testid="v2-hand-card"]')];
    if (slots.includes(this)) return box(80 + slots.indexOf(this) * 105, 160, 95, 130);
    if (cards.includes(this)) return box(20 + cards.indexOf(this) * 95, 420, 85, 130);
    if (this.classList.contains('v2-hand-scroll')) return box(20, 410, 900, 170);
    if (this.classList.contains('v2-battle-actions')) return box(0, 700, 1024, 68);
    return box(0, 0, 1024, 768);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function boot(input?: RunState) {
  const state = input ?? createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'pointer-test');
  localStorage.setItem(SAVE_KEY, serializeRun(state)); render(<GameApp initialState={state} />); return state;
}
const saved = () => parseRun(localStorage.getItem(SAVE_KEY)!);
const card = (index = 0) => screen.getAllByTestId('v2-hand-card')[index]!;
const slot = (index = 0) => screen.getAllByTestId('v2-slot')[index]!;
const mouse = (node: Element, from: { x: number; y: number }, to: { x: number; y: number }) => {
  fireEvent.pointerDown(node, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: to.x, clientY: to.y });
};
describe('V2 direct manipulation', () => {
  it('drags a hand card into a slot, commits only on release and suppresses the trailing click', () => {
    const state = boot(), id = state.battle!.hand[0]!, before = localStorage.getItem(SAVE_KEY);
    fireEvent.pointerDown(card(), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 60, clientY: 460 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 125, clientY: 220 });
    expect(screen.getByTestId('v2-drag-ghost')).toBeTruthy();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 125, clientY: 220 });
    expect(saved().battle!.slots[0]).toBe(id);
    expect(saved().revision).toBe(state.revision + 1);
    expect(saved().rng).toEqual(state.rng);
    fireEvent.click(slot(), { detail: 1 });
    expect(screen.queryByRole('button', { name: '撤回第 1 格' })).toBeNull();
  });
  it('swaps two staged cards atomically and drags a staged card back into the hand', () => {
    let state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'swap');
    const first = state.battle!.hand[0]!, second = state.battle!.hand[1]!;
    state = act(state, { type: 'stage', cardId: first, slot: 0 }).state;
    state = act(state, { type: 'stage', cardId: second, slot: 1 }).state; boot(state);
    mouse(slot(0), { x: 125, y: 220 }, { x: 230, y: 220 });
    expect(saved().battle!.slots.slice(0, 2)).toEqual([second, first]);
    mouse(slot(1), { x: 230, y: 220 }, { x: 40, y: 470 });
    expect(saved().battle!.slots[1]).toBeNull();
    expect(saved().battle!.hand[0]).toBe(first);
    expect(saved().battle!.playsLeft).toBe(4);
  });
  it('reorders hand cards without accidentally staging or spending a play', () => {
    const state = boot(), ids = state.battle!.hand;
    mouse(card(3), { x: 345, y: 460 }, { x: 35, y: 460 });
    expect(saved().battle!.hand[0]).toBe(ids[3]);
    expect(new Set(saved().battle!.hand).size).toBe(8);
    expect(saved().battle!.slots.every(id => id === null)).toBe(true);
    expect(saved().battle!.playsLeft).toBe(4);
  });
  it('rejects a slot hidden outside the horizontal formation viewport', () => {
    boot(); const before = saved();
    Object.defineProperty(document.querySelector('.v2-formation-scroll')!, 'getBoundingClientRect', { value: () => box(80, 140, 240, 160) });
    mouse(card(), { x: 60, y: 460 }, { x: 440, y: 220 });
    expect(saved()).toEqual(before);
    mouse(card(), { x: 60, y: 460 }, { x: 330, y: 220 });
    expect(saved()).toEqual(before);
  });
  it('does not return a card to hand behind the sticky action buttons', () => {
    let state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'covered-hand');
    state = act(state, { type: 'stage', cardId: state.battle!.hand[0]!, slot: 0 }).state;
    boot(state); const before = saved();
    Object.defineProperty(document.querySelector('.v2-battle-actions')!, 'getBoundingClientRect', { value: () => box(0, 450, 1024, 100) });
    mouse(slot(), { x: 125, y: 220 }, { x: 230, y: 470 });
    expect(saved()).toEqual(before);
  });
  it('leaves the complete game state unchanged after an invalid drop or Escape', () => {
    boot(); const before = localStorage.getItem(SAVE_KEY);
    mouse(card(), { x: 60, y: 460 }, { x: 980, y: 350 });
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    fireEvent.pointerDown(card(), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 60, clientY: 460 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 125, clientY: 220 });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 125, clientY: 220 });
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
  });
  it('preserves a touch swipe before the long-press delay', () => {
    vi.useFakeTimers(); boot(); const before = localStorage.getItem(SAVE_KEY);
    const touch = { identifier: 7, clientX: 60, clientY: 460 };
    fireEvent.touchStart(card(), { touches: [touch], changedTouches: [touch] });
    fireEvent.touchMove(window, { touches: [{ ...touch, clientX: 125 }], changedTouches: [{ ...touch, clientX: 125 }] });
    reactAct(() => vi.advanceTimersByTime(500));
    fireEvent.touchEnd(window, { touches: [], changedTouches: [{ ...touch, clientX: 125 }] });
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });
  it('scrolls the hand with a horizontal touch without starting a drag or allowing a trailing selection', () => {
    vi.useFakeTimers(); boot(); const before = localStorage.getItem(SAVE_KEY);
    const row = document.querySelector<HTMLElement>('.v2-hand-scroll')!;
    row.scrollLeft = 20;
    const touch = { identifier: 7, clientX: 250, clientY: 460 };
    fireEvent.touchStart(card(2), { touches: [touch], changedTouches: [touch] });
    fireEvent.touchMove(window, { touches: [{ ...touch, clientX: 150 }], changedTouches: [{ ...touch, clientX: 150 }] });
    expect(row.scrollLeft).toBe(120);
    reactAct(() => vi.advanceTimersByTime(500));
    fireEvent.touchEnd(window, { touches: [], changedTouches: [{ ...touch, clientX: 150 }] });
    fireEvent.click(card(2), { detail: 1 });
    expect(card(2).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });
  it('keeps a cancelled drag suppressed until the held pointer is actually released', () => {
    vi.useFakeTimers(); boot(); const before = localStorage.getItem(SAVE_KEY);
    fireEvent.pointerDown(card(), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 60, clientY: 460 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 125, clientY: 220 });
    fireEvent.keyDown(document, { key: 'Escape' });
    reactAct(() => vi.advanceTimersByTime(1200));
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 60, clientY: 460 });
    fireEvent.click(card(), { detail: 1 });
    expect(card().getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });
  it('continues a horizontal hand swipe after a small diagonal movement', () => {
    vi.useFakeTimers(); boot(); const before = localStorage.getItem(SAVE_KEY);
    const row = document.querySelector<HTMLElement>('.v2-hand-scroll')!;
    const touch = { identifier: 7, clientX: 250, clientY: 460 };
    fireEvent.touchStart(card(2), { touches: [touch], changedTouches: [touch] });
    fireEvent.touchMove(window, { touches: [{ ...touch, clientX: 241, clientY: 468 }], changedTouches: [{ ...touch, clientX: 241, clientY: 468 }] });
    reactAct(() => vi.advanceTimersByTime(500));
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
    fireEvent.touchMove(window, { touches: [{ ...touch, clientX: 150, clientY: 470 }], changedTouches: [{ ...touch, clientX: 150, clientY: 470 }] });
    expect(row.scrollLeft).toBe(100);
    fireEvent.touchEnd(window, { touches: [], changedTouches: [touch] });
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });
  it('suppresses a trailing double-click after dragging back to the original slot', () => {
    let state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'trailing-double-click');
    state = act(state, { type: 'stage', cardId: state.battle!.hand[0]!, slot: 0 }).state;
    boot(state); fireEvent.click(slot(), { detail: 1 });
    fireEvent.pointerDown(slot(), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 125, clientY: 220 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 980, clientY: 350 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 125, clientY: 220 });
    fireEvent.click(slot(), { detail: 2 }); fireEvent.doubleClick(slot(), { detail: 2 });
    expect(saved().battle!.slots[0]).toBe(state.battle!.slots[0]);
    expect(saved().revision).toBe(state.revision);
  });
  it('starts touch dragging only after holding, then places the card on release', () => {
    vi.useFakeTimers(); const state = boot(); const touch = { identifier: 7, clientX: 60, clientY: 460 };
    fireEvent.touchStart(card(), { touches: [touch], changedTouches: [touch] });
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
    reactAct(() => vi.advanceTimersByTime(310));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
    fireEvent.touchMove(card(), { touches: [{ ...touch, clientX: 125, clientY: 220 }], changedTouches: [{ ...touch, clientX: 125, clientY: 220 }] });
    expect(screen.getByTestId('v2-drag-ghost')).toBeTruthy();
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.touchEnd(window, { touches: [], changedTouches: [{ ...touch, clientX: 125, clientY: 220 }] });
    expect(saved().battle!.slots[0]).toBe(state.battle!.hand[0]);
  });
  it('Escape cancels an inspected and armed phone card before the same finger moves', () => {
    vi.useFakeTimers(); boot(); const before = saved();
    const touch = { identifier: 7, clientX: 60, clientY: 460 };
    fireEvent.touchStart(card(), { touches: [touch], changedTouches: [touch] });
    reactAct(() => vi.advanceTimersByTime(310));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(card(), { key: 'Escape' });
    fireEvent.touchMove(card(), { touches: [{ ...touch, clientX: 125, clientY: 220 }], changedTouches: [{ ...touch, clientX: 125, clientY: 220 }] });
    fireEvent.touchEnd(window, { touches: [], changedTouches: [{ ...touch, clientX: 125, clientY: 220 }] });
    expect(saved()).toEqual(before);
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
  });
  it.each(['blur', 'touchcancel', 'second-touch', 'native-scroll'])('cancels %s without changing the saved battle', reason => {
    vi.useFakeTimers(); boot(); const before = localStorage.getItem(SAVE_KEY);
    const touch = { identifier: 7, clientX: 60, clientY: 460 };
    fireEvent.touchStart(card(), { touches: [touch], changedTouches: [touch] });
    reactAct(() => vi.advanceTimersByTime(310));
    fireEvent.touchMove(card(), { touches: [{ ...touch, clientX: 80, clientY: 450 }], changedTouches: [{ ...touch, clientX: 80, clientY: 450 }] });
    expect(screen.getByTestId('v2-drag-ghost')).toBeTruthy();
    if (reason === 'blur') fireEvent(window, new Event('blur'));
    else if (reason === 'touchcancel') fireEvent.touchCancel(window, { touches: [], changedTouches: [touch] });
    else if (reason === 'second-touch') fireEvent.touchStart(window, { touches: [touch, { ...touch, identifier: 8 }], changedTouches: [{ ...touch, identifier: 8 }] });
    else fireEvent.touchMove(window, { cancelable: false, touches: [{ ...touch, clientX: 125, clientY: 220 }], changedTouches: [{ ...touch, clientX: 125, clientY: 220 }] });
    fireEvent.touchEnd(window, { touches: [], changedTouches: [{ ...touch, clientX: 125, clientY: 220 }] });
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });
  it('allows a fresh press after losing focus without receiving the old pointer release', () => {
    boot();
    fireEvent.pointerDown(card(), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 60, clientY: 460 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 125, clientY: 220 });
    fireEvent(window, new Event('blur'));
    fireEvent.pointerDown(screen.getByRole('button', { name: /弃牌.*3/ }), { pointerId: 1, pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse' });
    fireEvent.click(screen.getByRole('button', { name: /弃牌.*3/ }), { detail: 1 });
    expect(screen.getByRole('button', { name: '返回布阵' })).toBeTruthy();
  });
  it('allows click placement when dragging is disabled in saved settings', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ dragEnabled: false })); boot();
    const before = localStorage.getItem(SAVE_KEY);
    mouse(card(), { x: 60, y: 460 }, { x: 125, y: 220 });
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    fireEvent.click(card()); fireEvent.click(slot());
    expect(saved().battle!.hand).toHaveLength(7);
  });
  it('supports double-click quick placement and atomic recall', () => {
    const state = boot();
    fireEvent.doubleClick(card());
    expect(saved().battle!.slots[0]).toBe(state.battle!.hand[0]);
    fireEvent.click(screen.getByRole('button', { name: '全部撤回' }));
    expect(saved().battle!.hand).toHaveLength(8);
    expect(saved().battle!.slots.every(id => id === null)).toBe(true);
  });
  it('persists operation settings separately and merges older sound preferences', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ muted: true, music: 12 }));
    render(<GameApp />); fireEvent.click(screen.getByRole('button', { name: '暂时跳过，直接游戏' })); fireEvent.click(screen.getByRole('button', { name: /操作与设置/ }));
    const toggle = screen.getByRole('checkbox', { name: /启用卡牌拖动/ });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    const preferences = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(preferences.dragEnabled).toBe(false);
    expect(preferences.muted).toBe(true);
    expect(preferences.music).toBe(12);
  });
});
