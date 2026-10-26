import { act as reactAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameApp from '../../v2/ui/game-app';
import { CardDetail, CardFace } from '../../v2/ui/primitives';
import { CARDS, CARD_MAP, DECKS } from '../../v2/data';
import { createLegacyRun as createRun } from '../../v2/engine';
import { SAVE_KEY, serializeRun } from '../../v2/persistence';
import { SETTINGS_KEY } from '../../v2/ui/menu-screens';
import { CardInspector } from '../../v2/ui/card-inspector';

class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse'; }
}
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.stubGlobal('PointerEvent', TestPointerEvent); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const advance = (ms = 1500) => reactAct(() => vi.advanceTimersByTime(ms));
function boot() {
  const state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'card-inspection');
  localStorage.setItem(SAVE_KEY, serializeRun(state)); render(<GameApp initialState={state} />);
  return { state, button: screen.getAllByTestId('v2-hand-card')[0]!, definition: CARD_MAP[state.cards[state.battle!.hand[0]!]!.definitionId]! };
}
const touch = { identifier: 7, clientX: 60, clientY: 460 };

describe('card identity and inspection', () => {
  it('does not inspect a distant card when hovering a container with blank space', () => {
    render(<CardInspector holdMs={300} contextKey="blank"><section data-testid="card-container"><button><CardFace definition={CARDS[0]!} /></button></section></CardInspector>);
    fireEvent.pointerOver(screen.getByTestId('card-container'), { pointerType: 'mouse' }); advance();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it.each(['character', 'weapon', 'tactic'] as const)('marks %s cards with a type icon and a visible rarity', type => {
    const definition = CARDS.find(card => card.type === type)!;
    const { container } = render(<CardFace definition={definition} />);
    const face = container.querySelector('.v2-card-face')!;
    expect(face.getAttribute('data-card-type')).toBe(type);
    expect(face.getAttribute('data-card-rarity')).toBe(definition.rarity);
    expect(face.querySelector('.v2-card-type-icon')).toBeTruthy();
    expect(face.querySelector('.v2-card-rarity')?.textContent).toBeTruthy();
  });
  it('shows the original rarity even when a card is the leader', () => {
    const definition = CARDS.find(card => card.rarity === 'epic')!;
    const { container } = render(<CardFace definition={definition} leader />);
    expect(container.querySelector('.v2-card-rarity')?.textContent).toContain('史诗');
    expect(container.querySelector('.v2-card-leader')?.textContent).toBe('先锋');
  });
  it.each([false, true])('keeps the profession beside the name and uses full stat labels (compact: %s)', compact => {
    const definition = CARD_MAP['three_kingdoms.character.xia_hou_dun']!;
    const { container } = render(<CardFace definition={definition} compact={compact} />);
    const title = container.querySelector('.v2-card-title')!;
    expect(title?.textContent).toBe('夏侯惇武者');
    expect(title?.querySelector('small')?.textContent).toBe('武者');
    expect(screen.getByText(`威力 ${definition.power}`)).toBeTruthy();
    expect(screen.getByText(`增幅 ${definition.amp}`)).toBeTruthy();
    expect(screen.getByText('技能：砺兵')).toBeTruthy();
    expect(screen.queryByText(definition.text)).toBeNull();
  });
  it('shows only names for native and enhancement skills on the card face', () => {
    const definition = CARD_MAP['three_kingdoms.character.xia_hou_dun']!;
    const state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'skill-tags');
    const instance = { ...state.cards[state.leaderId!]!, enhancementSkills: ['xian_deng', 'jun_xu'] };
    render(<CardFace definition={definition} instance={instance} />);
    expect(screen.getByText('技能：砺兵')).toBeTruthy();
    expect(screen.getByText('先登')).toBeTruthy();
    expect(screen.getByText('军需')).toBeTruthy();
    expect(screen.queryByText(/本卡本场第一次主动出战/)).toBeNull();
    expect(screen.queryByText(/结算后获得 1 金币/)).toBeNull();
  });
  it('omits the native skill row and empty rule paragraph for cards without a skill', () => {
    const definition = CARDS.find(card => !card.skill)!;
    const { container } = render(<CardDetail definition={definition} />);
    expect(container.querySelector('.v2-card-skills')).toBeNull();
    expect(container.querySelector('.v2-rule-text')).toBeNull();
    expect(screen.queryByText('无技能。')).toBeNull();
  });
  it.each(CARDS.filter(card => card.skill))('gives $name a concise native skill name', definition => {
    const { container } = render(<CardFace definition={definition} compact />);
    const skill = container.querySelector('.v2-card-native-skill')?.textContent;
    expect(skill).toMatch(/^技能：[\u4e00-\u9fff]{2,6}$/);
    expect(container.textContent).not.toContain(definition.text);
  });
  it('keeps enhancement names on a card without inventing a native skill', () => {
    const definition = CARDS.find(card => !card.skill)!;
    const state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'plain-skill-tags');
    const instance = { ...state.cards[state.leaderId!]!, enhancementSkills: ['zhen_jun'] };
    const { container } = render(<CardFace definition={definition} instance={instance} />);
    expect(container.querySelector('.v2-card-native-skill')).toBeNull();
    expect(screen.getByText('振军')).toBeTruthy();
  });
  it('explains automatic adjacent equipment and keeps the exact weapon skill limits', () => {
    const definition = CARD_MAP['three_kingdoms.weapon.zhen_jun_yi_dao']!;
    render(<CardInspector holdMs={300} contextKey="weapon"><button><CardFace definition={definition} /></button></CardInspector>);
    fireEvent.pointerOver(screen.getByRole('button'), { pointerType: 'mouse' }); advance();
    const info = screen.getByRole('tooltip');
    expect(info.textContent).toContain('每场限一次，本局最多三次');
    expect(info.textContent).toContain('左右直接相邻');
    expect(info.textContent).toContain('职业加成较高');
    expect(info.textContent).toContain('同分优先左侧');
    expect(info.textContent).not.toContain('选择配属');
  });
  it('shows the full rule after mouse hovering without changing the save', () => {
    const { button, definition } = boot(), before = localStorage.getItem(SAVE_KEY);
    fireEvent.pointerOver(button.querySelector('.v2-card-face')!, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull(); advance(1499);
    expect(screen.queryByRole('tooltip')).toBeNull(); advance(1);
    const info = screen.getByRole('tooltip');
    expect(within(info).getByText(definition.name)).toBeTruthy();
    expect(within(info).getByText(/结算后.*本局永久威力 \+10/)).toBeTruthy();
    expect(info.textContent).toContain('当前威力');
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });
  it('does not flash an introduction after the pointer leaves before its delay', () => {
    const { button } = boot();
    fireEvent.pointerOver(button.querySelector('.v2-card-face')!, { pointerType: 'mouse' }); advance(1499);
    fireEvent.pointerOut(button, { relatedTarget: document.body, pointerType: 'mouse' }); advance(1500);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('starts a fresh 1500ms delay when moving to another card', () => {
    render(<CardInspector holdMs={300} contextKey="change-card"><button><CardFace definition={CARDS[0]!} /></button><button><CardFace definition={CARDS[1]!} /></button></CardInspector>);
    const [first, second] = screen.getAllByRole('button');
    fireEvent.pointerOver(first!, { pointerType: 'mouse' }); advance(1499);
    fireEvent.pointerOut(first!, { relatedTarget: second, pointerType: 'mouse' });
    fireEvent.pointerOver(second!, { pointerType: 'mouse' }); advance(1499);
    expect(screen.queryByRole('tooltip')).toBeNull(); advance(1);
    expect(within(screen.getByRole('tooltip')).getByText(CARDS[1]!.name)).toBeTruthy();
  });
  it.each(['click', 'scroll', 'pointerdown', 'dragstart'])('cancels a pending mouse inspection on %s', reason => {
    const { button } = boot();
    fireEvent.pointerOver(button, { pointerType: 'mouse' }); advance(1499);
    if (reason === 'click') fireEvent.click(button);
    else if (reason === 'scroll') fireEvent.scroll(window);
    else if (reason === 'dragstart') fireEvent.dragStart(button);
    else fireEvent.pointerDown(button, { pointerType: 'mouse', buttons: 1 });
    advance(); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('keeps the introduction open when the mouse returns to the same card during its close delay', () => {
    const { button } = boot(), face = button.querySelector('.v2-card-face')!;
    fireEvent.pointerOver(face, { pointerType: 'mouse' }); advance();
    fireEvent.pointerOut(button, { relatedTarget: document.body, pointerType: 'mouse' }); advance(70);
    fireEvent.pointerOver(face, { pointerType: 'mouse' }); advance(200);
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });
  it('closes the introduction when the mouse leaves a card for a normal button', () => {
    const { button } = boot(), target = screen.getByRole('button', { name: '总览' });
    fireEvent.pointerOver(button.querySelector('.v2-card-face')!, { pointerType: 'mouse' }); advance();
    fireEvent.pointerOut(button, { relatedTarget: target, pointerType: 'mouse' });
    fireEvent.pointerOver(target, { pointerType: 'mouse' }); advance(200);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('shows permanent and temporary instance bonuses in the current values', () => {
    const state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'inspect-growth');
    const instance = state.cards[state.battle!.hand[0]!]!, definition = CARD_MAP[instance.definitionId]!;
    instance.permanentPower = 5; instance.temporaryPower = 4; instance.permanentAmp = 2; instance.temporaryAmp = 1;
    render(<GameApp initialState={state} />);
    fireEvent.pointerOver(screen.getAllByTestId('v2-hand-card')[0]!.querySelector('.v2-card-face')!, { pointerType: 'mouse' }); advance();
    const stats = screen.getByRole('tooltip').querySelectorAll('.v2-inspect-stats b');
    expect(stats[0]!.textContent).toBe(String(definition.power + 9));
    expect(stats[1]!.textContent).toBe(String(definition.amp + 3));
  });
  it.each(['escape', 'scroll', 'blur'])('dismisses a hovered introduction on %s', reason => {
    const { button } = boot();
    fireEvent.pointerOver(button.querySelector('.v2-card-face')!, { pointerType: 'mouse' }); advance();
    expect(screen.getByRole('tooltip')).toBeTruthy();
    if (reason === 'escape') fireEvent.keyDown(button, { key: 'Escape' });
    else if (reason === 'scroll') fireEvent.scroll(window);
    else fireEvent(window, new Event('blur'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('lets the pointer enter the introduction and read it without closing', () => {
    const { button } = boot();
    fireEvent.pointerOver(button.querySelector('.v2-card-face')!, { pointerType: 'mouse' }); advance();
    const info = screen.getByRole('tooltip');
    fireEvent.pointerOut(button, { relatedTarget: info, pointerType: 'mouse' });
    fireEvent.pointerEnter(info, { pointerType: 'mouse' }); advance(500);
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });
  it('opens details on a stationary phone hold and suppresses the release click', () => {
    const { button } = boot(), before = localStorage.getItem(SAVE_KEY);
    fireEvent.touchStart(button, { touches: [touch], changedTouches: [touch] }); advance(310);
    expect(within(screen.getByRole('tooltip')).getByText(/结算后.*本局永久威力 \+10/)).toBeTruthy();
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
    fireEvent.touchEnd(button, { touches: [], changedTouches: [touch] });
    fireEvent.click(button, { detail: 1 });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });
  it.each([200, 300, 450])('preserves the exact %sms phone hold setting', holdMs => {
    render(<CardInspector holdMs={holdMs} contextKey="phone-setting"><button><CardFace definition={CARDS[0]!} /></button></CardInspector>);
    const button = screen.getByRole('button');
    fireEvent.touchStart(button, { touches: [touch], changedTouches: [touch] }); advance(holdMs - 1);
    expect(screen.queryByRole('tooltip')).toBeNull(); advance(1);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.touchEnd(button, { touches: [], changedTouches: [touch] }); advance();
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });
  it('cancels phone inspection if the finger swipes before holding', () => {
    const { button } = boot(), before = localStorage.getItem(SAVE_KEY);
    fireEvent.touchStart(button, { touches: [touch], changedTouches: [touch] });
    fireEvent.touchMove(button, { touches: [{ ...touch, clientX: 130 }], changedTouches: [{ ...touch, clientX: 130 }] }); advance(600);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });
  it('keeps phone inspection available when card dragging is disabled', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ dragEnabled: false }));
    const { button } = boot();
    fireEvent.touchStart(button, { touches: [touch], changedTouches: [touch] }); advance(310);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.queryByTestId('v2-drag-ghost')).toBeNull();
  });
  it('keeps a long phone explanation open when its own content starts native scrolling', () => {
    const { button } = boot();
    fireEvent.touchStart(button, { touches: [touch], changedTouches: [touch] }); advance(310);
    const info = screen.getByRole('tooltip');
    fireEvent.pointerCancel(info, { pointerType: 'touch' }); fireEvent.scroll(info);
    expect(screen.getByRole('tooltip')).toBe(info);
  });
  it('prevents a long hold from choosing a reward, then allows a fresh press after closing details', () => {
    const choose = vi.fn(), definition = CARDS[0]!;
    render(<CardInspector holdMs={300} contextKey="reward"><button onClick={choose}><CardFace definition={definition} /></button></CardInspector>);
    const button = screen.getByRole('button');
    fireEvent.touchStart(button, { touches: [touch], changedTouches: [touch] }); advance(310);
    fireEvent.touchEnd(button, { touches: [], changedTouches: [touch] }); fireEvent.click(button, { detail: 1 });
    expect(choose).not.toHaveBeenCalled();
    fireEvent.pointerDown(button, { pointerType: 'touch' }); fireEvent.click(button, { detail: 1 });
    expect(choose).not.toHaveBeenCalled();
    fireEvent.pointerDown(button, { pointerType: 'touch' }); fireEvent.click(button, { detail: 1 });
    expect(choose).toHaveBeenCalledTimes(1);
  });
  it('uses the first outside phone tap only to close details rather than trigger another action', () => {
    const play = vi.fn();
    render(<CardInspector holdMs={300} contextKey="outside-tap"><button><CardFace definition={CARDS[0]!} /></button><button onClick={play}>出战</button></CardInspector>);
    const source = screen.getAllByRole('button')[0]!, target = screen.getByRole('button', { name: '出战' });
    fireEvent.touchStart(source, { touches: [touch], changedTouches: [touch] }); advance(310);
    fireEvent.touchEnd(source, { touches: [], changedTouches: [touch] });
    fireEvent.pointerDown(target, { pointerType: 'touch' });
    fireEvent.touchStart(target, { touches: [touch], changedTouches: [touch] });
    fireEvent.touchEnd(target, { touches: [], changedTouches: [touch] }); fireEvent.click(target, { detail: 1 });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
  it('supports keyboard inspection and restores the trigger description on dismissal', () => {
    const { button } = boot();
    fireEvent.keyDown(button, { key: 'Tab' }); fireEvent.focus(button); advance();
    const info = screen.getByRole('tooltip');
    expect(button.getAttribute('aria-describedby')).toContain(info.id);
    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBeNull();
  });
});
