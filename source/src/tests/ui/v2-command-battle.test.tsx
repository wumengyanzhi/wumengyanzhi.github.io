import { act as reactAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CARDS, DECKS } from '../../v2/data';
import { act, createRun } from '../../v2/engine';
import { previewBattle } from '../../v2/battle';
import { BattleScreen } from '../../v2/ui/battle-screen';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const run = () => createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'command-layout');

it('opens charm details on a stationary long press and cancels inspection when scrolling the rail', () => {
  vi.useFakeTimers();
  const charm = vi.fn();
  render(<BattleScreen state={run()} send={vi.fn()} detail={vi.fn()} charm={charm} />);
  const button = screen.getByRole('button', { name: /锦囊 1：/ });
  fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] });
  reactAct(() => vi.advanceTimersByTime(450));
  expect(charm).toHaveBeenCalledTimes(1);
  fireEvent.touchEnd(button);
  fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] });
  fireEvent.touchMove(button, { touches: [{ clientX: 10, clientY: 30 }] });
  reactAct(() => vi.advanceTimersByTime(500));
  expect(charm).toHaveBeenCalledTimes(1);
});

it('keeps all three forecast terms visible on an empty board and moves resources into the right rail', () => {
  const { container } = render(<BattleScreen state={run()} send={vi.fn()} detail={vi.fn()} charm={vi.fn()} />);
  const forecast = screen.getByRole('region', { name: '伤害预览' });
  for (const term of ['威力', '增幅', '伤害']) expect(within(forecast).getByText(term)).toBeTruthy();
  expect(forecast.textContent).toContain('=');
  expect(container.querySelector('[data-battle-region="rail"] .v2-resource-strip')).toBeTruthy();
  expect(container.querySelector('[data-battle-region="hud"] .v2-resource-strip')).toBeNull();
  expect(screen.getByRole('button', { name: '查看首领情报与行程' })).toBeTruthy();
  expect(screen.getByText('1-1')).toBeTruthy();
  expect(screen.queryByText('拖动布阵 · 点选也可')).toBeNull();
  expect(screen.queryByText('先布阵，再出战')).toBeNull();
});

it('merges charms into the skill list, preserves their tier and reflects actual triggered sources', () => {
  let state = run();
  state.charms = [
    { id: 'blade', definitionId: 'three_kingdoms.charm.cui_bing_fu', acquiredPrice: 0, tier: 2 },
    { id: 'two', definitionId: 'three_kingdoms.charm.shuang_feng_jun_yin', acquiredPrice: 0, tier: 1 }, null,
  ];
  const id = state.battle!.hand[0]!;
  state.cards[id]!.definitionId = CARDS.find(card => card.name === '蜀中猛士')!.id;
  state = act(state, { type: 'stage', cardId: id, slot: 2 }).state;
  const charm = vi.fn();
  const { container, rerender } = render(<BattleScreen state={state} send={vi.fn()} detail={vi.fn()} charm={charm} />);
  const rail = screen.getByRole('region', { name: '本次技能' });
  const inspect = within(rail).getByRole('button', { name: /锦囊 1：淬兵符/ });
  expect(inspect.getAttribute('data-charm-tier')).toBe('Ⅱ');
  expect(container.querySelector('[data-charm-id="blade"]')!.getAttribute('data-charm-state')).toBe('waiting');
  fireEvent.click(inspect);
  expect(charm).toHaveBeenCalledWith(state.charms[0]!.definitionId);
  const weapon = state.battle!.hand[0]!;
  state.cards[weapon]!.definitionId = CARDS.find(card => card.name === '环首刀')!.id;
  state = act(state, { type: 'stage', cardId: weapon, slot: 1 }).state;
  rerender(<BattleScreen state={state} send={vi.fn()} detail={vi.fn()} charm={charm} />);
  const report = previewBattle(state).report!;
  expect(report.sources.some(source => source.kind === 'charm' && source.label.includes('淬兵符') && !source.label.includes('未触发'))).toBe(true);
  expect(container.querySelector('[data-charm-id="blade"]')!.getAttribute('data-charm-state')).toBe('ready');
  expect(container.querySelectorAll('[data-charm-slot]')).toHaveLength(3);
  expect(within(screen.getByRole('region', { name: '伤害预览' })).getByText(report.damage.toLocaleString())).toBeTruthy();
});
