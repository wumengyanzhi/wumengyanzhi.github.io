import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameApp from '../../v2/ui/game-app';
import { act, createLegacyRun as createRun } from '../../v2/engine';
import { CARD_MAP, DECKS } from '../../v2/data';
import { SAVE_KEY, parseRun, serializeRun } from '../../v2/persistence';
import { HISTORY_KEY, NewRunScreen, TutorialScreen } from '../../v2/ui/menu-screens';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('V2 完整游戏界面', () => {
  it('正式主菜单突出开始与教学，不提供数值演练或开发化说明', () => {
    render(<GameApp />);
    fireEvent.click(screen.getByRole('button', { name: '暂时跳过，直接游戏' }));
    expect(screen.getByRole('button', { name: '踏上征途' }).textContent).toContain('开始远征');
    expect(screen.getByRole('button', { name: /新手演武/ })).toBeTruthy();
    expect(screen.getAllByRole('navigation', { name: '场外功能' })[0]!.querySelectorAll('button')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /数值演练/ })).toBeNull();
    expect(screen.queryByText(/无账号远征/)).toBeNull();
  });

  it('开局不要求输入种子，调整选择和重试始终使用本次内部种子', () => {
    const start = vi.fn();
    render(<NewRunScreen start={start} eliteUnlocked={false} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/远征种子|可复现/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认出征' }));
    const seed = start.mock.calls[0]![2] as string;
    expect(seed.trim().length).toBeGreaterThan(0);
    const deck = DECKS[1]!;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(deck.name) }));
    fireEvent.click(screen.getByRole('button', { name: '确认出征' }));
    expect(start.mock.calls[1]).toEqual([deck.id, deck.leaders[0], seed, 'standard']);
  });

  it('玩法速查说明相邻自动配属和择优规则，不再要求手选装备对象', () => {
    render(<TutorialScreen />);
    expect(screen.getByText(/职业加成更高.*同分.*左侧/)).toBeTruthy();
    expect(screen.getByText(/技能.*名称.*详情/)).toBeTruthy();
    expect(screen.queryByText(/亲自选择目标/)).toBeNull();
  });

  it('选流派与先锋后才开始远征，五格与八张手牌完整呈现', () => {
    render(<GameApp />);
    fireEvent.click(screen.getByRole('button', { name: '暂时跳过，直接游戏' }));
    expect(screen.getByRole('heading', { name: '五阵破军' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '踏上征途' }));
    expect(screen.getByText('选择你的流派')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认出征' }));
    expect(screen.getAllByTestId('v2-slot')).toHaveLength(5);
    expect(screen.getAllByTestId('v2-hand-card')).toHaveLength(8);
  });

  it('开始新远征仍需确认替换，取消保留旧档，确认后才写入新局', () => {
    const deck = DECKS[0]!;
    const original = serializeRun(createRun(deck.id, deck.leaders[0]!, 'keep-current-expedition'));
    localStorage.setItem(SAVE_KEY, original);
    render(<GameApp />);
    fireEvent.click(screen.getByRole('button', { name: '踏上征途' }));
    fireEvent.click(screen.getByRole('button', { name: '确认出征' }));
    expect(screen.getByRole('dialog', { name: '开启全新远征' })).toBeTruthy();
    expect(localStorage.getItem(SAVE_KEY)).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: '保留当前远征' }));
    expect(localStorage.getItem(SAVE_KEY)).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: '确认出征' }));
    fireEvent.click(screen.getByRole('button', { name: '确认替换，启程' }));
    expect(screen.getAllByTestId('v2-hand-card')).toHaveLength(8);
    expect(parseRun(localStorage.getItem(SAVE_KEY)!).seed).not.toBe('keep-current-expedition');
  });

  it('点选手牌再点格位布阵，撤回不消耗出战', () => {
    const deck = DECKS[0]!;
    render(<GameApp initialState={createRun(deck.id, deck.leaders[0]!, 'ui-test')} />);
    fireEvent.click(screen.getAllByTestId('v2-hand-card')[0]!);
    fireEvent.click(screen.getAllByTestId('v2-slot')[0]!);
    expect(screen.getAllByTestId('v2-hand-card')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: '撤回第 1 格' }));
    expect(screen.getAllByTestId('v2-hand-card')).toHaveLength(8);
    expect(screen.getByText('4 / 4')).toBeTruthy();
  });

  it('首战传说奖励不可跳过，选卡后进入实体强化', () => {
    const deck = DECKS[0]!;
    let state = createRun(deck.id, deck.leaders[0]!, 'ui-reward');
    state.battle!.hp = 1;
    const cardId = state.battle!.hand.find(id => CARD_MAP[state.cards[id]!.definitionId]!.power > 0)!;
    state = act(state, { type: 'stage', cardId, slot: 0 }).state;
    state = act(state, { type: 'play' }).state;
    render(<GameApp initialState={state} />);
    expect(screen.queryByRole('button', { name: '跳过新卡' })).toBeNull();
    const rewardButton = screen.getAllByRole('button', { name: /收入牌组/ })[0]!;
    fireEvent.click(rewardButton);
    fireEvent.click(rewardButton);
    expect(screen.getByText('百炼成锋')).toBeTruthy();
    expect(parseRun(localStorage.getItem(SAVE_KEY)!).owned).toHaveLength(31);
  });

  it('保存失败时保留原手牌和牌位，不呈现未提交进度', () => {
    const deck = DECKS[0]!;
    render(<GameApp initialState={createRun(deck.id, deck.leaders[0]!, 'storage-fail')} />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(screen.getAllByTestId('v2-hand-card')[0]!);
    fireEvent.click(screen.getAllByTestId('v2-slot')[0]!);
    expect(screen.getAllByTestId('v2-hand-card')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: '撤回第 1 格' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('操作尚未生效');
  });

  it('检测到其他页面已写入新进度时停止旧页面命令', () => {
    const deck = DECKS[0]!;
    const state = createRun(deck.id, deck.leaders[0]!, 'conflict');
    localStorage.setItem(SAVE_KEY, serializeRun(state));
    render(<GameApp initialState={state} />);
    const next = act(state, { type: 'stage', cardId: state.battle!.hand[0]!, slot: 2 }).state;
    localStorage.setItem(SAVE_KEY, serializeRun(next));
    fireEvent.click(screen.getAllByTestId('v2-hand-card')[1]!);
    fireEvent.click(screen.getAllByTestId('v2-slot')[0]!);
    expect(screen.getByRole('dialog', { name: '远征已在其他页面更新' })).toBeTruthy();
    expect(parseRun(localStorage.getItem(SAVE_KEY)!).revision).toBe(next.revision);
  });

  it('损坏存档保持原文，并允许前往设置导出', () => {
    localStorage.setItem(SAVE_KEY, '{broken');
    render(<GameApp />);
    expect(screen.getByRole('alert').textContent).toContain('原始内容已保留');
    expect(localStorage.getItem(SAVE_KEY)).toBe('{broken');
    fireEvent.click(screen.getByRole('button', { name: /操作与设置/ }));
    expect(screen.getByRole('button', { name: '导出当前远征' }).hasAttribute('disabled')).toBe(false);
  });

  it('冲突读取同一战的另一局存档时清除旧手牌选择，不崩溃', () => {
    const deck = DECKS[0]!;
    const state = createRun(deck.id, deck.leaders[0]!, 'old-tab');
    localStorage.setItem(SAVE_KEY, serializeRun(state));
    render(<GameApp initialState={state} />);
    fireEvent.click(screen.getAllByTestId('v2-hand-card')[0]!);
    const latest = createRun(deck.id, deck.leaders[0]!, 'new-tab');
    const rename = (id: string) => `card-${Number(id.split('-').at(-1)) + 100}`;
    latest.cards = Object.fromEntries(Object.values(latest.cards).map(card => [rename(card.id), { ...card, id: rename(card.id) }]));
    latest.nextId += 100;
    latest.owned = latest.owned.map(id => rename(id));
    latest.leaderId = rename(latest.leaderId!);
    latest.battle!.hand = latest.battle!.hand.map(id => rename(id));
    latest.battle!.draw = latest.battle!.draw.map(id => rename(id));
    localStorage.setItem(SAVE_KEY, serializeRun(latest));
    fireEvent.click(screen.getAllByTestId('v2-slot')[0]!);
    expect(() => fireEvent.click(screen.getByRole('button', { name: '读取最新进度' }))).not.toThrow();
    expect(screen.getAllByTestId('v2-hand-card')).toHaveLength(8);
    expect(screen.getAllByTestId('v2-hand-card').every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.queryByRole('button', { name: '撤回第 1 格' })).toBeNull();
    expect(screen.queryByText('拖动布阵 · 点选也可')).toBeNull();
  });

  it('同种子相同操作的新远征各记一次，同一远征重复加载不重复记录', () => {
    const deck = DECKS[0]!;
    let state = createRun(deck.id, deck.leaders[0]!, 'same-history');
    // Four empty-amplification single-card plays produce a valid defeated run.
    for (let index = 0; index < 4 && state.phase === 'battle'; index++) {
      const cardId = state.battle!.hand.find(id => CARD_MAP[state.cards[id]!.definitionId]!.type === 'character')!;
      state = act(state, { type: 'stage', cardId, slot: 0 }).state;
      state = act(state, { type: 'play' }).state;
    }
    expect(state.phase).toBe('lost');
    state.runId = 'history-run-one';
    const first = render(<GameApp initialState={state} />);
    first.unmount();
    const second = render(<GameApp initialState={{ ...state, runId: 'history-run-two' }} />);
    second.unmount();
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)).toHaveLength(2);
    render(<GameApp initialState={state} />);
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)).toHaveLength(2);
  });
});
