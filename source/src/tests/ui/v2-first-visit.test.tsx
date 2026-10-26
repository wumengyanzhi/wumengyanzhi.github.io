import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameApp from '../../v2/ui/game-app';
import { ONBOARDING_KEY } from '../../v2/ui/first-visit';
import { TUTORIAL_KEY, parseTutorial } from '../../v2/tutorial';
import { SAVE_KEY, serializeRun } from '../../v2/persistence';
import { createLegacyRun as createRun } from '../../v2/engine';
import { DECKS } from '../../v2/data';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('首次进入游戏的教学选择', () => {
  it('新玩家先选择是否学习，同意后直接进入点击引导', () => {
    render(<GameApp />);
    expect(screen.getByRole('dialog', { name: '是否进入新手教程？' })).toBeTruthy();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(localStorage.getItem(TUTORIAL_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '进入新手教程' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-tutorial-step="select-character"]')).toBeTruthy();
    expect(screen.getByRole('region', { name: '教学提示' })).toBeTruthy();
    expect(parseTutorial(localStorage.getItem(TUTORIAL_KEY)!).step).toBe('select-character');
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('accepted');
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });
  it('拒绝后进入菜单，刷新不再询问，仍可主动学习', () => {
    render(<GameApp />);
    fireEvent.click(screen.getByRole('button', { name: '暂时跳过，直接游戏' }));
    expect(screen.getByRole('button', { name: '踏上征途' })).toBeTruthy();
    expect(localStorage.getItem(TUTORIAL_KEY)).toBeNull();
    cleanup(); render(<GameApp />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /新手演武/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始演武' }));
    expect(document.querySelector('[data-tutorial-step="select-character"]')).toBeTruthy();
  });
  it('同意后刷新保留引导进度且不重复弹出首次问题', () => {
    render(<GameApp />); fireEvent.click(screen.getByRole('button', { name: '进入新手教程' }));
    cleanup(); render(<GameApp />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /继续演武/ }));
    expect(document.querySelector('[data-tutorial-step="select-character"]')).toBeTruthy();
  });
  it('已有远征的玩家正常进入，不改变已有存档', () => {
    const raw = serializeRun(createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'returning'));
    localStorage.setItem(SAVE_KEY, raw); render(<GameApp />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /继续远征/ })).toBeTruthy();
    expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    fireEvent.click(screen.getByRole('button', { name: /继续远征/ }));
    expect(screen.getAllByTestId('v2-hand-card')).toHaveLength(8);
    expect(screen.getAllByTestId('v2-slot')).toHaveLength(5);
    expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
  });
  it('首次选择无法保存时明确提示，允许重试', () => {
    render(<GameApp />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(screen.getByRole('button', { name: '暂时跳过，直接游戏' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('选择未能保存');
    vi.restoreAllMocks(); fireEvent.click(screen.getByRole('button', { name: '暂时跳过，直接游戏' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
