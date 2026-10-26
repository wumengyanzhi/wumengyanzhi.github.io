import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import GameApp from '../../v2/ui/game-app';
import { createLegacyRun as createRun } from '../../v2/engine';
import { CARDS, DECKS } from '../../v2/data';
import { parseRun, SAVE_KEY, serializeRun } from '../../v2/persistence';
import type { RunState } from '../../v2/model';
import { battleSkillCues } from '../../v2/ui/battle-guidance';
import { resolvePlay } from '../../v2/battle';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function boot(slots: (string | null)[], hand: string[] = [], configure?: (state: RunState) => void) {
  const state = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'battle-guidance');
  state.leaderId = null;
  let cursor = 0;
  const assign = (name: string) => {
    const id = state.owned[cursor++]!;
    state.cards[id]!.definitionId = CARDS.find(card => card.name === name)!.id;
    return id;
  };
  state.battle!.slots = Array.from({ length: 5 }, (_, index) => slots[index] ? assign(slots[index]!) : null);
  const explicitHand = hand.map(assign);
  state.battle!.hand = [...explicitHand, ...state.owned.slice(cursor, cursor + 8 - explicitHand.length)];
  state.battle!.draw = state.owned.filter(id => !state.battle!.hand.includes(id) && !state.battle!.slots.includes(id));
  state.battle!.discard = [];
  configure?.(state);
  localStorage.setItem(SAVE_KEY, serializeRun(state));
  render(<GameApp initialState={state} />);
  return state;
}
const saved = () => parseRun(localStorage.getItem(SAVE_KEY)!);
const handCard = (name: string) => screen.getAllByRole('button', { name })[0]!;

describe('visible card pairing and skill actions', () => {
  it('recommends weapons on their faces when selecting a character without changing the save', () => {
    boot([], ['蜀中猛士', '环首刀', '长柄铁枪']);
    const before = localStorage.getItem(SAVE_KEY);
    fireEvent.click(handCard('蜀中猛士'));
    expect(within(handCard('环首刀')).getByText(/本职.*增幅.*4/)).toBeTruthy();
    expect(within(handCard('长柄铁枪')).getByText(/适配.*增幅.*2/)).toBeTruthy();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });

  it('recommends characters on their faces when selecting a weapon', () => {
    boot([], ['长柄铁枪', '蜀中猛士', '魏营宿卫']);
    fireEvent.click(handCard('长柄铁枪'));
    expect(within(handCard('魏营宿卫')).getByText(/本职.*增幅.*4/)).toBeTruthy();
    expect(within(handCard('蜀中猛士')).getByText(/适配.*增幅.*2/)).toBeTruthy();
  });

  it('shows the actual automatic owner and permits battle without any equipment dropdown', () => {
    boot(['蜀中猛士', '长柄铁枪', '魏营宿卫']);
    const weapon = screen.getAllByTestId('v2-slot')[1]!;
    expect(weapon.textContent).toContain('装备：魏营宿卫');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect((screen.getByRole('button', { name: /出战破阵/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('previews automatic Li Bing then reports the actual weapon growth after playing', () => {
    const state = boot(['夏侯惇', '环首刀']);
    const weaponId = state.battle!.slots[1]!;
    const panel = screen.getByRole('region', { name: '本次技能' });
    expect(panel.textContent).toContain('砺兵');
    expect(panel.textContent).toContain('已就绪');
    fireEvent.click(within(panel).getByRole('button', { name: '查看砺兵详情' }));
    expect(screen.getByRole('dialog', { name: '砺兵说明' }).textContent).toContain('环首刀');
    fireEvent.click(screen.getByRole('button', { name: '关闭技能详情' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /出战破阵/ }));
    expect(saved().cards[weaponId]!.permanentPower).toBe(10);
    fireEvent.click(screen.getByRole('button', { name: '查看本次效果' }));
    expect(screen.getByRole('status', { name: '本次出战结果' }).textContent).toContain('本局永久威力 +10');
  });

  it('chooses Pang Tong targets by clicking cards without moving them', () => {
    const state = boot(['庞统', '筹措军粮', '擂鼓进军']);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /指定连环目标/ }));
    fireEvent.click(screen.getAllByTestId('v2-slot')[2]!);
    expect(saved().battle!.targets[`skill:${state.battle!.slots[0]}`]).toBe(state.battle!.slots[2]);
    expect(saved().battle!.slots).toEqual(state.battle!.slots);
    expect((screen.getByRole('button', { name: /出战破阵/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not consume a Sun Shang Xiang weapon on entering or cancelling target mode', () => {
    const state = boot(['孙尚香'], ['环首刀']);
    const initial = localStorage.getItem(SAVE_KEY);
    fireEvent.click(screen.getByRole('button', { name: /发动弓腰姬/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(localStorage.getItem(SAVE_KEY)).toBe(initial);
    fireEvent.click(screen.getByRole('button', { name: /发动弓腰姬/ }));
    fireEvent.click(handCard('环首刀'));
    expect(saved().battle!.hand).toEqual(state.battle!.hand);
    expect(saved().battle!.targets[`skill:${state.battle!.slots[0]}`]).toBe(state.battle!.hand[0]);
    fireEvent.click(screen.getByRole('button', { name: /取消发动/ }));
    expect(saved().battle!.targets[`skill:${state.battle!.slots[0]}`]).toBe('');
    expect(saved().battle!.hand).toEqual(state.battle!.hand);
  });

  it('does not turn a double click selecting a consumable into quick staging', () => {
    const state = boot(['孙尚香'], ['环首刀']);
    fireEvent.click(screen.getByRole('button', { name: /发动弓腰姬/ }));
    const weapon = handCard('环首刀');
    fireEvent.click(weapon, { detail: 1 });
    fireEvent.click(weapon, { detail: 2 });
    fireEvent.doubleClick(weapon, { detail: 2 });
    expect(saved().battle!.slots).toEqual(state.battle!.slots);
    expect(saved().battle!.hand).toEqual(state.battle!.hand);
    expect(saved().battle!.targets[`skill:${state.battle!.slots[0]}`]).toBe(state.battle!.hand[0]);
  });

  it('does not unstage a tactic after a double click selecting its skill target', () => {
    const state = boot(['庞统', '筹措军粮', '擂鼓进军'], [], state => {
      state.battle!.draw.push(...state.battle!.hand.splice(5));
    });
    fireEvent.click(screen.getByRole('button', { name: /指定连环目标/ }));
    const tactic = screen.getAllByTestId('v2-slot')[2]!;
    fireEvent.click(tactic, { detail: 1 });
    fireEvent.click(tactic, { detail: 2 });
    fireEvent.doubleClick(tactic, { detail: 2 });
    expect(saved().battle!.slots).toEqual(state.battle!.slots);
    expect(saved().battle!.targets[`skill:${state.battle!.slots[0]}`]).toBe(state.battle!.slots[2]);
  });

  it('ignores double clicks on ineligible cards while selecting a tactic target', () => {
    const state = boot(['庞统', '筹措军粮', '擂鼓进军'], ['环首刀'], state => {
      state.battle!.draw.push(...state.battle!.hand.splice(5));
    });
    fireEvent.click(screen.getByRole('button', { name: /指定连环目标/ }));
    const character = screen.getAllByTestId('v2-slot')[0]!;
    fireEvent.click(character, { detail: 1 });
    fireEvent.click(character, { detail: 2 });
    fireEvent.doubleClick(character, { detail: 2 });
    expect(saved().battle!.slots).toEqual(state.battle!.slots);
    expect(screen.getByText('选择高亮战术')).toBeTruthy();
  });

  it.each([false, true])('reports real gold effects even when the play ends battle (%s)', lethal => {
    const state = boot(['蜀中猛士', '环首刀', '筹措军粮'], [], state => {
      if (lethal) state.battle!.hp = 1;
    });
    fireEvent.click(screen.getByRole('button', { name: /出战破阵/ }));
    expect(saved().gold).toBeGreaterThan(state.gold);
    if (!lethal) fireEvent.click(screen.getByRole('button', { name: '查看本次效果' }));
    const result = screen.getByRole('status', { name: '本次出战结果' });
    expect(result.textContent).toContain('筹措军粮');
    expect(result.textContent).toContain('金币 +1');
  });

  it('shows repeated gold income and records the actual total', () => {
    const state = boot(['蜀中猛士', '环首刀', '筹措军粮']);
    const tactic = state.battle!.slots[2]!;
    state.cards[tactic]!.chain = true;
    expect(battleSkillCues(state).find(cue => cue.sourceId === tactic)!.message).toContain('2 金币');
    const gold = state.gold;
    const report = resolvePlay(state);
    expect(state.gold - gold).toBe(2);
    expect(report.notes.filter(note => note.includes('筹措军粮') && note.includes('金币 +1'))).toHaveLength(2);
  });

  it('bounds repeated reinforcements by available characters and reports full-hand destinations', () => {
    const state = boot(['急召援军']);
    const tactic = state.battle!.slots[0]!;
    state.cards[tactic]!.chain = true;
    const character = state.battle!.draw[0]!;
    state.cards[character]!.definitionId = CARDS.find(card => card.name === '蜀中猛士')!.id;
    state.battle!.draw = [character];
    const cue = battleSkillCues(state).find(cue => cue.sourceId === tactic)!;
    expect(cue.message).toContain('1 张人物');
    expect(cue.message).toContain('满手入弃牌堆');
    const report = resolvePlay(state);
    expect(report.notes).toContain('急召援军：蜀中猛士，手牌已满，进入弃牌堆');
  });

  it('previews both reinforcement draws when the chain has enough characters', () => {
    const state = boot(['急召援军']);
    const tactic = state.battle!.slots[0]!;
    state.cards[tactic]!.chain = true;
    for (const id of state.battle!.draw) state.cards[id]!.definitionId = CARDS.find(card => card.name === '蜀中猛士')!.id;
    expect(battleSkillCues(state).find(cue => cue.sourceId === tactic)!.message).toContain('2 张人物');
    expect(resolvePlay(state).notes.filter(note => note.startsWith('急召援军：'))).toHaveLength(2);
  });

  it('records the one-time supply enhancement income', () => {
    const state = boot(['蜀中猛士']);
    state.cards[state.battle!.slots[0]!]!.enhancementSkills = ['jun_xu'];
    expect(resolvePlay(state).notes).toContain('蜀中猛士 · 军需：金币 +1');
  });

  it('reports Zhou Yu actual temporary growth from characters left in hand', () => {
    const state = boot(['周瑜'], ['江东铁卫']);
    for (const id of state.battle!.hand.slice(1)) state.cards[id]!.definitionId = CARDS.find(card => card.name === '环首刀')!.id;
    expect(resolvePlay(state).notes).toContain('周瑜本场临时威力 +20');
    expect(state.cards[state.owned[0]!]!.temporaryPower).toBe(20);
  });
});
