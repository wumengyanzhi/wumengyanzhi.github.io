import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARDS, DECKS } from '../../v2/data';
import { createLegacyRun } from '../../v2/engine';
import type { SkillCue } from '../../v2/ui/battle-guidance';
import { battleSkillCues } from '../../v2/ui/battle-guidance';
import { getCardRuleText } from '../../v2/ui/card-copy';
import { SkillPanel } from '../../v2/ui/skill-panel';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function fixture(names: string[], hand: string[] = []) {
  const state = createLegacyRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'skill-rail');
  let cursor = 0;
  const assign = (name: string) => {
    const id = state.owned[cursor++]!;
    state.cards[id]!.definitionId = CARDS.find(card => card.name === name)!.id;
    return id;
  };
  state.battle!.slots = Array.from({ length: 5 }, (_, index) => names[index] ? assign(names[index]!) : null);
  state.battle!.hand = hand.map(assign);
  return state;
}

function panel(cues: SkillCue[], extra: Partial<Parameters<typeof SkillPanel>[0]> = {}) {
  const select = vi.fn(), cancelEffect = vi.fn();
  return { select, cancelEffect, ...render(<SkillPanel cues={cues} selecting={null} disabled={false} select={select} cancelEffect={cancelEffect} {...extra} />) };
}

describe('permanent compact skill rail', () => {
  it('keeps an empty rail and dark slot before any card is staged', () => {
    panel([]);
    const rail = screen.getByRole('region', { name: '本次技能' });
    expect(within(rail).queryByText('暂无技能')).toBeNull();
    expect(rail.querySelector('.v2-skill-empty')).toBeTruthy();
  });

  it('shows compact truthful labels for all states without long default explanation', () => {
    const cues = (['waiting', 'ready', 'choose', 'used', 'optional', 'passive'] as const).map((state, index) => ({
      id: `skill:${index}`, sourceId: `${index}`, sourceName: '来源人物', name: `技能${index}`, state,
      message: `完整条件说明${index}`, targetIds: [],
    }));
    panel(cues);
    for (const text of ['未满足', '已就绪', '待指定', '已使用', '可选发动', '被动']) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/完整条件说明/)).toBeNull();
    expect(screen.queryByText('将触发')).toBeNull();
    for (const state of ['waiting', 'ready', 'choose', 'used', 'optional', 'passive']) {
      expect(document.querySelector(`.v2-skill-${state} .v2-skill-state-icon`)).toBeTruthy();
    }
  });

  it('orders by formation source, then native before enhancement, regardless of cue priority', () => {
    const state = fixture(['夏侯惇', '环首刀', '庞统', '筹措军粮', '擂鼓进军']);
    state.cards[state.battle!.slots[0]!]!.enhancementSkills = ['xian_deng'];
    const cues = battleSkillCues(state).reverse();
    const props = { state, cues, selecting: null, disabled: false, select: vi.fn(), cancelEffect: vi.fn() };
    const { rerender } = render(<SkillPanel {...props} />);
    const expected = [0, 0, 2, 3, 4].map(slot => state.battle!.slots[slot]);
    const sources = () => Array.from(document.querySelectorAll('[data-skill-source]')).map(node => node.getAttribute('data-skill-source'));
    expect(sources()).toEqual(expected);
    expect(document.querySelector('[data-skill-source]')!.textContent).toContain('砺兵');
    rerender(<SkillPanel {...props} cues={cues.map(cue => ({ ...cue, state: cue.state === 'choose' ? 'ready' : 'used' }))} />);
    expect(sources()).toEqual(expected);
  });

  it('reserves command space by native skill kind even before targets exist', () => {
    const state = fixture(['庞统', '夏侯惇']);
    const pang = state.battle!.slots[0]!;
    state.cards[pang]!.enhancementSkills = ['xian_deng'];
    const props = { state, cues: battleSkillCues(state), selecting: null, disabled: false, select: vi.fn(), cancelEffect: vi.fn() };
    const { rerender } = render(<SkillPanel {...props} />);
    const native = () => document.querySelector(`[data-skill-id="skill:${pang}"]`)!;
    expect(native().classList.contains('v2-skill-command-cue')).toBe(true);
    expect(document.querySelector('.v2-skill-waiting:not(.v2-skill-command-cue)')).toBeTruthy();
    expect(document.querySelector(`[data-skill-id="xian_deng:${pang}"]`)!.classList.contains('v2-skill-command-cue')).toBe(false);
    state.battle!.slots[2] = state.owned[2]!;
    state.cards[state.owned[2]!]!.definitionId = CARDS.find(card => card.name === '筹措军粮')!.id;
    rerender(<SkillPanel {...props} cues={battleSkillCues(state)} />);
    expect(native().classList.contains('v2-skill-command-cue')).toBe(true);
    rerender(<SkillPanel {...props} state={undefined} cues={battleSkillCues(state)} />);
    expect(native().classList.contains('v2-skill-command-cue')).toBe(true);
  });
});

describe('skill inspection without skill execution', () => {
  it.each(['click', 'hover', 'focus'] as const)('opens the full current explanation and card rule by %s in a portal', interaction => {
    const state = fixture(['夏侯惇', '环首刀']);
    const before = JSON.stringify(state);
    const cues = battleSkillCues(state);
    const { container, select, cancelEffect } = panel(cues, { state });
    const trigger = screen.getByRole('button', { name: '查看砺兵详情' });
    if (interaction === 'click') fireEvent.click(trigger);
    if (interaction === 'hover') fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    if (interaction === 'focus') fireEvent.focus(trigger);
    const detail = screen.getByRole('dialog', { name: '砺兵说明' });
    expect(detail.textContent).toContain(cues[0]!.message);
    expect(detail.textContent).toContain(getCardRuleText(CARDS.find(card => card.name === '夏侯惇')!));
    expect(container.contains(detail)).toBe(false);
    expect(detail.style.position).toBe('fixed');
    expect(select).not.toHaveBeenCalled();
    expect(cancelEffect).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
  });

  it('opens an enhancement own rule rather than repeating its native rule', () => {
    const state = fixture(['夏侯惇']);
    state.cards[state.battle!.slots[0]!]!.enhancementSkills = ['xian_deng'];
    panel(battleSkillCues(state), { state });
    fireEvent.click(screen.getByRole('button', { name: '查看先登详情' }));
    expect(screen.getByRole('dialog').textContent).toContain('本卡本场第一次主动出战，本次威力 +25。');
  });

  it('supports Enter and Space, Escape, and an outside click without action', () => {
    const state = fixture(['夏侯惇']);
    const { select } = panel(battleSkillCues(state), { state });
    const trigger = screen.getByRole('button', { name: '查看砺兵详情' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(trigger, { key: ' ' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('requires the configured phone hold delay and cancels inspection when the finger moves', () => {
    vi.useFakeTimers();
    const state = fixture(['孙尚香'], ['环首刀']);
    const { select } = panel(battleSkillCues(state), { state, holdMs: 400 });
    const trigger = screen.getByRole('button', { name: '查看弓腰姬详情' });
    fireEvent.touchStart(trigger, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
    act(() => vi.advanceTimersByTime(399));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.touchEnd(trigger, { touches: [] });
    fireEvent.click(trigger, { detail: 1 });
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.touchStart(trigger, { touches: [{ identifier: 2, clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(trigger, { touches: [{ identifier: 2, clientX: 10, clientY: 30 }] });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('also supports a short phone tap without action and clears a pending hold after unmount', () => {
    vi.useFakeTimers();
    const state = fixture(['夏侯惇']);
    const { unmount, select } = panel(battleSkillCues(state), { state, holdMs: 400 });
    const trigger = screen.getByRole('button', { name: '查看砺兵详情' });
    fireEvent.touchStart(trigger, { touches: [{ identifier: 1, clientX: 0, clientY: 0 }] });
    fireEvent.touchEnd(trigger, { touches: [] });
    fireEvent.click(trigger, { detail: 1 });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.touchStart(trigger, { touches: [{ identifier: 2, clientX: 0, clientY: 0 }] });
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('real target commands stay directly accessible', () => {
  it('preserves mandatory selection separately from opening details', () => {
    const state = fixture(['庞统', '筹措军粮', '擂鼓进军']);
    const cues = battleSkillCues(state);
    const { select } = panel(cues, { state });
    fireEvent.click(screen.getByRole('button', { name: '查看连环奇谋详情' }));
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '指定连环目标' }));
    expect(select).toHaveBeenCalledExactlyOnceWith(cues.find(cue => cue.name === '连环奇谋')!.choice);
  });

  it('keeps optional activation and cancelling a chosen weapon functional', () => {
    const state = fixture(['孙尚香'], ['环首刀']);
    state.battle!.targets[`skill:${state.battle!.slots[0]}`] = state.battle!.hand[0]!;
    const cues = battleSkillCues(state);
    const { select, cancelEffect } = panel(cues, { state });
    fireEvent.click(screen.getByRole('button', { name: '发动弓腰姬，指定手牌兵器' }));
    expect(select).toHaveBeenCalledExactlyOnceWith(cues[0]!.choice);
    fireEvent.click(screen.getByRole('button', { name: '取消发动弓腰姬' }));
    expect(cancelEffect).toHaveBeenCalledExactlyOnceWith(cues[0]!.choice);
  });

  it('disables commands while preserving inspection and never invents passive actions', () => {
    const state = fixture(['孙尚香', '关羽'], ['环首刀']);
    panel(battleSkillCues(state), { state, disabled: true });
    expect((screen.getByRole('button', { name: '发动弓腰姬，指定手牌兵器' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '查看淬武成势详情' }));
    expect(screen.getByRole('dialog').textContent).toContain('20');
    const passive = document.querySelector('.v2-skill-passive')!;
    expect(within(passive as HTMLElement).getAllByRole('button')).toHaveLength(1);
  });
});
