import { act as reactAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARDS, DECKS, ENEMIES } from '../../v2/data';
import { act, createRun } from '../../v2/engine';
import { previewBattle } from '../../v2/battle';
import type { RunState } from '../../v2/model';
import { BossIntel } from '../../v2/ui/boss-intel';
import { BattleOverview } from '../../v2/ui/battle-overview';
import { EnemyHealth } from '../../v2/ui/combat-feedback';
import { BattleScreen } from '../../v2/ui/battle-screen';
import { CampScreen } from '../../v2/ui/campaign-screens';
import GameApp from '../../v2/ui/game-app';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const run = () => createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'readability');
const props = (state: RunState) => ({ state, send: vi.fn(), detail: vi.fn(), charm: vi.fn() });
function bossState(index: number) {
  const state = run();
  state.battleIndex = index;
  state.battle!.enemyId = ENEMIES[index]!.id;
  state.battle!.hp = state.battle!.maxHp = ENEMIES[index]!.hp;
  return state;
}
function character(state: RunState) {
  return state.battle!.hand.find(id => CARDS.find(d => d.id === state.cards[id]!.definitionId)?.type === 'character')!;
}

describe('Boss intelligence before and during combat', () => {
  it.each([0, 6, 12])('shows the upcoming chapter boss rule without expanding at node %i', index => {
    const state = bossState(index);
    render(<BossIntel state={state} />);
    const panel = screen.getByRole('region', { name: '首领战前情报' });
    expect(panel.textContent).toContain(ENEMIES[index + 5]!.name);
    expect(panel.textContent).toContain(ENEMIES[index + 5]!.text);
    expect(panel.querySelector('details')).toBeNull();
  });
  it.each([5, 11, 17])('truthfully marks whether the actual boss penalty is avoided at node %i', index => {
    const state = bossState(index), id = character(state);
    if (index === 11) state.battle!.slots[1] = id;
    const { rerender } = render(<BossIntel state={state} live />);
    expect(screen.getByRole('region', { name: '首领技能' }).textContent).toContain('削弱生效');
    if (index === 5) state.battle!.slots[2] = id;
    if (index === 11) state.battle!.slots[1] = null;
    if (index === 17) {
      const other = state.battle!.hand.find(other => other !== id)!;
      state.cards[other]!.definitionId = CARDS.find(d => d.type === 'character')!.id;
      state.battle!.slots[0] = id; state.battle!.slots[4] = other;
    }
    rerender(<BossIntel state={{ ...state }} live />);
    expect(screen.getByRole('region', { name: '首领技能' }).textContent).toContain('已规避削弱');
  });
  it('shows the full boss warning before the camp continue button', () => {
    const state = bossState(4); state.phase = 'camp'; state.battle = null;
    render(<CampScreen {...props(state)} />);
    const intel = screen.getByRole('region', { name: '首领战前情报' });
    expect(intel.textContent).toContain(ENEMIES[5]!.text);
    expect(screen.getByRole('button', { name: /迎战下一阵/ })).toBeTruthy();
  });
});

it('puts live damage above formation cards and detailed matching rules in overview', () => {
  let state = run();
  const a = state.battle!.hand[0]!, b = state.battle!.hand[1]!;
  state.cards[a]!.definitionId = CARDS.find(d => d.name === '蜀中猛士')!.id;
  state.cards[b]!.definitionId = CARDS.find(d => d.name === '环首刀')!.id;
  state = act(state, { type: 'stage', cardId: a, slot: 0 }).state;
  state = act(state, { type: 'stage', cardId: b, slot: 1 }).state;
  const { container } = render(<BattleScreen {...props(state)} />);
  const preview = screen.getByRole('region', { name: '伤害预览' });
  expect(container.querySelector('.v2-formation')!.contains(preview)).toBe(true);
  expect(container.querySelector('.v2-command-bar .v2-preview')).toBeNull();
  expect(preview.textContent).toContain(previewBattle(state).report!.damage.toLocaleString());
  expect(preview.compareDocumentPosition(container.querySelector('.v2-formation-scroll')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '总览' }));
  const table = screen.getByRole('table', { name: '职业与兵器增幅加成' });
  expect(within(table).getByRole('row', { name: /术士/ }).textContent).toContain('+1');
  expect(within(table).getByRole('row', { name: /暗客/ }).textContent).toContain('+2');
  expect(within(table).getByRole('row', { name: /武者/ }).textContent).toContain('+4');
  expect(screen.getByRole('dialog').textContent).toContain('环首刀 → 蜀中猛士');
  expect(screen.getByRole('dialog').textContent).toContain('同分优先左侧');
});

it('labels a multiplier net change as explanation rather than a second operation', () => {
  let state = run();
  const names = ['环首刀', '蜀中猛士', '长柄铁枪'];
  const ids = state.battle!.hand.slice(0, 3);
  ids.forEach((id, i) => { state.cards[id]!.definitionId = CARDS.find(card => card.name === names[i])!.id; });
  for (let slot = 0; slot < ids.length; slot++) state = act(state, { type: 'stage', cardId: ids[slot]!, slot }).state;
  state.charms = [{ id: 'test-route', definitionId: 'three_kingdoms.charm.shuang_feng_jun_yin', acquiredPrice: 8, tier: 1 }, null, null];
  const { container } = render(<BattleOverview state={state} choose={vi.fn()} />);
  const row = [...container.querySelectorAll('.v2-overview-sources > div')].find(element => element.textContent?.includes('双锋军印'))!;
  expect(row.textContent).toContain('增幅 ×1.3（净变化 +2.7）');
  expect(row.textContent).not.toContain('增幅 +2.7 ×1.3');
});

describe('committed enemy hit feedback', () => {
  it('does not animate on load or preview; delays the trail only for real loss and does not restart on preview changes', () => {
    vi.useFakeTimers();
    const base = { enemyId: 'same', hp: 100, maxHp: 100, playCount: 0, damage: 0, forecastDamage: 30 };
    const { rerender } = render(<EnemyHealth {...base} />);
    expect(screen.queryByLabelText('敌阵受击')).toBeNull();
    rerender(<EnemyHealth {...base} hp={80} playCount={1} damage={20} />);
    expect(screen.getByLabelText('敌阵受击').textContent).toContain('20');
    expect(screen.getByTestId('v2-hp-trail').style.width).toBe('100%');
    expect(screen.getByRole('meter', { name: '敌阵耐久' }).getAttribute('aria-valuenow')).toBe('80');
    rerender(<EnemyHealth {...base} hp={80} playCount={1} damage={20} forecastDamage={50} />);
    reactAct(() => vi.advanceTimersByTime(500));
    expect(screen.getByTestId('v2-hp-trail').style.width).toBe('80%');
    reactAct(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByLabelText('敌阵受击')).toBeNull();
    rerender(<EnemyHealth {...base} hp={80} playCount={1} damage={20} forecastDamage={60} />);
    expect(screen.queryByLabelText('敌阵受击')).toBeNull();
  });
  it('updates the trail immediately when effects are disabled', () => {
    const base = { enemyId: 'same', hp: 100, maxHp: 100, playCount: 0, damage: 0, animate: false };
    const { rerender } = render(<EnemyHealth {...base} />);
    rerender(<EnemyHealth {...base} hp={50} playCount={1} damage={50} />);
    expect(screen.getByTestId('v2-hp-trail').style.width).toBe('50%');
  });
  it('shows the committed killing blow while the reward page opens', () => {
    const state = run();
    state.cards[state.battle!.hand[0]!]!.permanentPower = 100000;
    render(<GameApp initialState={state} />);
    fireEvent.click(screen.getAllByTestId('v2-hand-card')[0]!);
    fireEvent.click(screen.getAllByTestId('v2-slot')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /出战破阵/ }));
    expect(screen.getByRole('status', { name: '破阵反馈' }).textContent).toContain('击破');
    expect(screen.getAllByRole('button', { name: /收入牌组/ })).toHaveLength(3);
  });
});
