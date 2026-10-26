import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameApp from '../../v2/ui/game-app';
import { createLegacyRun as createRun } from '../../v2/engine';
import { DECKS } from '../../v2/data';
import { SAVE_KEY, serializeRun } from '../../v2/persistence';
import { HISTORY_KEY } from '../../v2/ui/menu-screens';
import { ONBOARDING_KEY } from '../../v2/ui/first-visit';
import { TUTORIAL_KEY, parseTutorial, serializeTutorial, tutorialCard, updateTutorial } from '../../v2/tutorial';

beforeEach(() => { localStorage.clear(); localStorage.setItem(ONBOARDING_KEY, 'declined'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const current = () => parseTutorial(localStorage.getItem(TUTORIAL_KEY)!);
const hand = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="v2-hand-card"][data-drag-card-id="${id}"]`)!;
const slot = (index: number) => document.querySelector<HTMLButtonElement>(`[data-v2-slot="${index}"]`)!;
function boot() { render(<GameApp />); fireEvent.click(screen.getByRole('button', { name: /新手演武/ })); fireEvent.click(screen.getByRole('button', { name: '开始演武' })); }
function adjacent() {
  fireEvent.click(hand(tutorialCard(current(), 'character'))); fireEvent.click(slot(1));
  fireEvent.click(hand(tutorialCard(current(), 'weapon'))); fireEvent.click(slot(3));
  fireEvent.click(slot(3)); fireEvent.click(slot(2));
}

describe('强制操作式新手演武', () => {
  it('只允许高亮目标，选牌与放置完成后自动进入下一步', () => {
    boot(); expect(current().step).toBe('select-character');
    fireEvent.click(hand(tutorialCard(current(), 'weapon')));
    expect(current().step).toBe('select-character');
    fireEvent.click(hand(tutorialCard(current(), 'character')));
    expect(current().step).toBe('place-character');
    fireEvent.click(slot(0)); expect(current().run.battle!.slots[0]).toBeNull();
    fireEvent.click(slot(1)); expect(current().step).toBe('select-weapon');
    expect(slot(1).querySelector('.v2-card-compact')).toBeNull();
    expect(screen.queryByRole('button', { name: '继续教学' })).toBeNull();
  });
  it('保存选择步骤，刷新后可直接点击指定格位继续', () => {
    const formal = serializeRun(createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'formal-kept'));
    localStorage.setItem(SAVE_KEY, formal); localStorage.setItem(HISTORY_KEY, '[]');
    boot(); fireEvent.click(hand(tutorialCard(current(), 'character')));
    cleanup(); render(<GameApp />); fireEvent.click(screen.getByRole('button', { name: /继续演武/ }));
    expect(current().step).toBe('place-character');
    fireEvent.click(slot(1)); expect(current().step).toBe('select-weapon');
    expect(localStorage.getItem(SAVE_KEY)).toBe(formal); expect(localStorage.getItem(HISTORY_KEY)).toBe('[]');
  });
  it('相邻配属后解释伤害，支持键盘移动及明细关闭自动推进', () => {
    boot(); adjacent(); expect(current().step).toBe('compare');
    expect(screen.getByRole('region', { name: '教学提示' }).textContent).toContain('自动配属');
    expect(screen.getByRole('region', { name: '教学提示' }).textContent).toContain('职业加成更高');
    fireEvent.click(screen.getByRole('button', { name: '知道了' })); expect(current().step).toBe('drag-weapon');
    fireEvent.click(slot(0), { detail: 0 }); expect(current().step).toBe('select-tactic');
    fireEvent.click(hand(tutorialCard(current(), 'tactic'))); fireEvent.click(slot(3)); expect(current().step).toBe('damage');
    fireEvent.click(screen.getByRole('button', { name: /结算明细/ })); expect(current().step).toBe('damage-read');
    fireEvent.click(screen.getByRole('button', { name: '关闭' })); expect(current().step).toBe('play');
    fireEvent.click(screen.getByRole('button', { name: /出战破阵/ })); expect(current().step).toBe('reward');
  });
  it('跳过与重练仍然可用，退出后恢复菜单操作', () => {
    boot(); fireEvent.click(screen.getByRole('button', { name: '跳过教学' })); expect(current().step).toBe('skipped');
    fireEvent.click(screen.getByRole('button', { name: '重新演武' })); expect(current().step).toBe('intro');
    fireEvent.click(screen.getByRole('button', { name: '开始演武' }));
    fireEvent.click(screen.getByRole('button', { name: '退出演武' }));
    fireEvent.click(screen.getByRole('button', { name: '踏上征途' })); expect(screen.getByText('选择你的流派')).toBeTruthy();
  });
  it('保存失败不清空待放置选择，恢复存储后可重试同一格位', () => {
    boot(); fireEvent.click(hand(tutorialCard(current(), 'character')));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(slot(1)); expect(current().step).toBe('place-character');
    expect(screen.getByRole('alert').textContent).toContain('操作尚未生效');
    vi.restoreAllMocks(); fireEvent.click(slot(1)); expect(current().step).toBe('select-weapon');
  });
  it('另一页面更新演武后读取最新内容，不覆盖新操作', () => {
    boot(); const session = current();
    const external = updateTutorial(session, { type: 'select', cardId: tutorialCard(session, 'character'), fromSlot: null }).session;
    localStorage.setItem(TUTORIAL_KEY, serializeTutorial(external));
    fireEvent.click(hand(tutorialCard(current(), 'character')));
    expect(screen.getByRole('alert').textContent).toContain('另一页面');
    fireEvent.click(screen.getByRole('button', { name: '读取最新教学进度' })); expect(current().step).toBe('place-character');
    fireEvent.click(slot(1)); expect(current().step).toBe('select-weapon');
  });
});
