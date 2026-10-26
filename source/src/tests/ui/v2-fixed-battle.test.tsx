import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createRun } from '../../v2/engine';
import { DECKS } from '../../v2/data';
import { BattleScreen } from '../../v2/ui/battle-screen';
import GameApp from '../../v2/ui/game-app';
import { charmDefinition } from '../../v2/campaign';

afterEach(cleanup);
it('reserves all battle regions before staging and keeps the staged hand shadow', () => {
  const state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'fixed-layout');
  const send = vi.fn();
  const props = { send, detail: vi.fn(), charm: vi.fn() };
  const { container, rerender } = render(<BattleScreen state={state} {...props} />);
  expect(screen.getByRole('region', { name: '本次技能' })).toBeTruthy();
  for (const area of ['hud', 'formation', 'notice', 'hand', 'command']) expect(container.querySelector(`[data-battle-region="${area}"]`)).toBeTruthy();
  expect(container.querySelectorAll('[data-hand-anchor]')).toHaveLength(8);
  const id = state.battle!.hand[1]!;
  const next = structuredClone(state);
  next.battle!.hand.splice(1, 1);
  next.battle!.slots[0] = id;
  next.revision++;
  rerender(<BattleScreen state={next} {...props} />);
  expect(container.querySelectorAll('[data-hand-anchor]')).toHaveLength(8);
  const shadow = container.querySelector('[data-hand-anchor="1"]')!;
  expect(shadow.getAttribute('data-drag-card-id')).toBeNull();
  expect(shadow.querySelector('button')).toBeNull();
  expect(screen.getAllByTestId('v2-hand-card')).toHaveLength(7);
  fireEvent.click(screen.getByRole('button', { name: /出战破阵/ }));
  expect(send).toHaveBeenCalledWith({ type: 'play' });
});

it('shows the owned charm tier rule and offers reordering inside its detail', () => {
  localStorage.clear();
  const state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'charm-inspection');
  const charm = state.charms[0]!;
  charm.tier = 2;
  render(<GameApp initialState={state} />);
  expect(screen.getByRole('button', { name: /锦囊 1：/ }).getAttribute('data-charm-tier')).toBe('Ⅱ');
  fireEvent.click(screen.getByRole('button', { name: /锦囊 1：/ }));
  expect(screen.getByRole('dialog').textContent).toContain(charmDefinition(state, charm.definitionId, 2).text);
  expect(screen.getByRole('button', { name: '锦囊右移' })).toBeTruthy();
});
