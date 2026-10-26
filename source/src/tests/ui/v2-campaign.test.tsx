import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRun, createLegacyRun } from '../../v2/engine';
import { CARD_MAP, DECKS } from '../../v2/data';
import type { RunState } from '../../v2/model';
import GameApp from '../../v2/ui/game-app';
import { RewardScreen, MarketScreen } from '../../v2/ui/campaign-screens';
import { CharmBar } from '../../v2/ui/primitives';
import { charmDefinition, enemiesFor } from '../../v2/campaign';
import { CharmRewardScreen } from '../../v2/ui/charm-reward-screen';
import { CodexScreen } from '../../v2/ui/menu-screens';
import { PlayResult } from '../../v2/ui/play-result';
import { createEnhancements } from '../../v2/campaign-rewards';

beforeEach(() => localStorage.clear());
afterEach(cleanup);
const run = () => createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'campaign-ui');
const props = (state: RunState) => ({ state, send: vi.fn(), detail: vi.fn(), charm: vi.fn() });

describe('十八局远征界面', () => {
  it('真实出战明细保留Boss削弱、锦囊乘幅和最终取整公式', () => {
    render(<PlayResult report={{power:75,amp:13,damage:975,actualDamage:975,overflow:0,playedIds:[],notes:[],sources:[{label:'封阵方士',power:-25,amp:0,kind:'enemy'},{label:'双锋军印 · Ⅰ阶',power:0,amp:3,kind:'charm',multiplier:1.3}]}} />);
    expect(screen.getByText(/封阵方士/)).toBeTruthy();expect(screen.getByText(/双锋军印/)).toBeTruthy();expect(screen.getByText(/75 × 13/)).toBeTruthy();
  });
  it('顶部简写当前关卡，点击后可展开三关行程和首领规则', () => {
    render(<GameApp initialState={run()} />);
    expect(screen.getByText('1-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /当前关卡.*查看行程/ }));
    const nav = screen.getByRole('navigation', { name: '三大关行程' });
    expect(within(nav).getAllByText(/第[一二三]关/)).toHaveLength(3);
    expect(nav.querySelectorAll('[data-battle-step]')).toHaveLength(6);
    expect(screen.getByRole('dialog', { name: '本关首领与规则' }).textContent).toContain('中军铁壁');
  });

  it('旧六战存档仍显示六战行程和旧锦囊效果', () => {
    const state = createLegacyRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'old-ui');
    render(<GameApp initialState={state} />);
    fireEvent.click(screen.getByRole('button', { name: /当前关卡.*查看行程/ }));
    expect(screen.getByRole('navigation', { name: '六战行程' }).querySelectorAll('span')).toHaveLength(6);
    expect(screen.getByRole('dialog').textContent).toContain(enemiesFor(state).find(enemy => enemy.kind === 'boss')!.text);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: /锦囊 1：/ }));
    expect(screen.getByRole('dialog').textContent).toContain(charmDefinition(state, state.charms[0]!.definitionId).text);
  });

  it('随机强化只允许选择展示的固定卡牌，没有下拉框，确认前显示前后值', () => {
    const state = run();
    createEnhancements(state);
    const option=state.enhancements[0]!,target=option.targetId,d=CARD_MAP[state.cards[target]!.definitionId]!;
    const p = props(state);
    render(<RewardScreen {...p} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByRole('button',{name:/确认强化/})).toHaveLength(3);
    expect(screen.getAllByText(new RegExp(`${d[option.stat]} →`)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /确认强化/ })[0]!);
    expect(p.send).toHaveBeenCalledWith({ type: 'chooseEnhancement', optionId: option.id });
    const applied = act(state, p.send.mock.calls[0]![0]);
    expect(applied.ok).toBe(true);
    expect(applied.state.cards[target]![option.stat==='power'?'permanentPower':'permanentAmp']).toBe(option.amount);
  });

  it('选卡可一换一并预告先锋与军势，首胜仍不可跳过', () => {
    const state = run();
    state.phase = 'cardReward';
    state.reward = { id: 'new-card', first: true, candidates: ['three_kingdoms.card.guan_yu'] };
    // Use an actual definition from the deck to avoid coupling this interaction to content naming.
    state.reward.candidates = [DECKS[0]!.cards[0]!];
    const p = props(state);
    render(<RewardScreen {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /替换旧牌/ }));
    const picker = screen.getByRole('dialog', { name: '选择替换实体' });
    fireEvent.click(within(picker).getAllByRole('button', { name: /^替换 / })[0]!);
    expect(within(picker).getByText(/下一战军势/)).toBeTruthy();
    fireEvent.click(within(picker).getByRole('button', { name: '确认一换一' }));
    expect(p.send).toHaveBeenCalledWith({ type: 'chooseCard', definitionId: state.reward.candidates[0], replaceId: state.owned[0] });
    const applied = act(state, p.send.mock.calls[0]![0]);
    expect(applied.ok).toBe(true);
    expect(applied.state.removed).toContain(state.owned[0]);
    expect(applied.state.owned.filter(id => !applied.state.removed.includes(id))).toHaveLength(30);
    expect(screen.queryByRole('button', { name: '跳过新卡' })).toBeNull();
  });

  it('按持有阶数显示锦囊名称与实际说明', () => {
    const state = run(); state.charms[0]!.tier = 2;
    render(<CharmBar state={state} send={vi.fn()} inspect={vi.fn()} />);
    expect(screen.getByText(/Ⅱ/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /锦囊 1：/ }).getAttribute('title')).toContain('＋6');
  });

  it('军市对新路线默认替换旧路线，其他槽位不可选，取消不发命令', () => {
    const state = run(); state.phase = 'market'; state.gold = 20;
    state.charms[1] = { id: 'route', definitionId: 'three_kingdoms.charm.shuang_feng_jun_yin', acquiredPrice: 6, tier: 1 };
    state.market = { id: 'shop', items: [{ id: 'new-route', definitionId: 'three_kingdoms.charm.zhou_liu_chou', sold: false }], forged: false, removed: false, rerolls: 0 };
    const p = props(state); render(<MarketScreen {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /选择槽位/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /第 2 槽/ }).className).toContain('v2-selected');
    expect(within(dialog).getByRole('button', { name: /第 3 槽/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消交易' }));
    expect(p.send).not.toHaveBeenCalled();
  });

  it('Boss奖励明确显示基础增幅，取消选槽不领，确认时完整提交', () => {
    const state = run(); state.phase = 'charmReward';
    state.charmReward = { id: 'boss', kind: 'boss', baseAmp: 4, routeAtVictory: null, candidates: [{ id: 'route-reward', definitionId: 'three_kingdoms.charm.shuang_feng_jun_yin', kind: 'gain', tier: 2 }] };
    const p = props(state); render(<CharmRewardScreen {...p} />);
    expect(screen.getByText(/基础增幅＋4/)).toBeTruthy();
    expect(screen.getByText(/增幅×1.6/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /选择获得/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }));
    expect(p.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /选择获得/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认领取' }));
    expect(p.send).toHaveBeenCalledExactlyOnceWith({ type: 'chooseCharmReward', optionId: 'route-reward', slot: 1 });
    const applied = act(state, p.send.mock.calls[0]![0]);
    expect(applied.ok).toBe(true);
    expect(applied.state.baseAmp).toBe(4);
    expect(applied.state.charms[1]?.tier).toBe(2);
    expect(applied.state.phase).toBe('camp');
  });

  it('Boss奖励明确跳过路线仍通过一次完整奖励命令领取基础增幅', () => {
    const state = run(); state.phase = 'charmReward';
    state.charmReward = { id: 'boss', kind: 'boss', baseAmp: 6, routeAtVictory: null, candidates: [] };
    const p = props(state); render(<CharmRewardScreen {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /跳过锦囊并领取基础增幅/ }));
    expect(p.send).toHaveBeenCalledExactlyOnceWith({ type: 'chooseCharmReward', optionId: null });
    const applied = act(state, p.send.mock.calls[0]![0]);
    expect(applied.ok).toBe(true);
    expect(applied.state.baseAmp).toBe(6);
    expect(act(applied.state, p.send.mock.calls[0]![0]).ok).toBe(false);
  });

  it('军市升阶展示当前和升级后效果，确认时指向具体槽位', () => {
    const state = run(); state.phase = 'market'; state.gold = 20;
    state.battles = [{ index: 5, enemyId: 'three_kingdoms.enemy.campaign_1_6', won: true, plays: 4, discards: 0, reports: [], remainingHp: 0 }];
    state.battleIndex = 7;
    state.market = { id: 'shop', items: [], forged: false, removed: false, rerolls: 0 };
    const p = props(state); render(<MarketScreen {...p} />);
    expect(screen.getByText('定向锻造 · 4 金')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选择升阶' }));
    expect(screen.getByText(/升阶后：.*＋6/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认升阶 · 4 金' }));
    expect(p.send).toHaveBeenCalledExactlyOnceWith({ type: 'upgradeCharm', slot: 0 });
    const applied = act(state, p.send.mock.calls[0]![0]);
    expect(applied.ok).toBe(true);
    expect(applied.state.charms[0]?.tier).toBe(2);
    expect(applied.state.gold).toBe(16);
    expect(applied.state.market?.upgraded).toBe(true);
  });

  it('随机强化显示递增重抽费用与余额，钱不足禁用，旧版仍每次奖励只刷新一次', () => {
    const state = run();createEnhancements(state);
    const p = props(state); const view = render(<RewardScreen {...p} />);
    fireEvent.click(screen.getByRole('button',{name:/重抽三项 · 2 金/}));
    expect(p.send).toHaveBeenCalledWith({type:'rerollEnhancement'});
    const next=act(state,{type:'rerollEnhancement'}).state;
    view.rerender(<RewardScreen {...props(next)} />);
    expect(screen.getByRole('button',{name:/重抽三项 · 3 金/}).hasAttribute('disabled')).toBe(true);
    const legacy = createLegacyRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'old-reward');
    legacy.phase = 'enhanceReward'; legacy.enhancements = [{ ...state.enhancements[0]!, targetIds: undefined }];
    view.rerender(<RewardScreen {...props(legacy)} />);
    expect(screen.getByRole('button', { name: /刷新三项/ })).toBeTruthy();
  });

  it('图鉴沿用当前远征版本：新局十八阵，旧档六阵和旧锦囊文案', () => {
    const state = run();
    const view = render(<CodexScreen detail={vi.fn()} state={state} />);
    fireEvent.click(screen.getByRole('button', { name: '敌阵' }));
    expect(view.container.querySelectorAll('.v2-codex-charms article')).toHaveLength(18);
    const legacy = createLegacyRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'legacy-codex');
    view.rerender(<CodexScreen detail={vi.fn()} state={legacy} />);
    expect(view.container.querySelectorAll('.v2-codex-charms article')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: '锦囊' }));
    expect(screen.getByText(charmDefinition(legacy, legacy.charms[0]!.definitionId).text)).toBeTruthy();
    expect(screen.queryByText('查看Ⅱ / Ⅲ阶效果')).toBeNull();
  });
});
