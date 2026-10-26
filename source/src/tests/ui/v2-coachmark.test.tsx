import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorialCoachmark } from '../../v2/ui/tutorial-coachmark';

const rect = (x = 50, y = 250, width = 100, height = 80) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });
const base = { step: 'first', title: '选一张牌', text: '点击金色边框里的牌。', selectors: ['#right'], progress: '1 / 20', onExit: vi.fn(), onSkip: vi.fn() };

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('v2-coachmark-bubble') ? rect(0, 0, 300, 180) : rect();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('聚光灯教学', () => {
  it('拦截错误目标，允许当前目标和安全出口', () => {
    const wrong = vi.fn(); const right = vi.fn(); const exit = vi.fn(); const skip = vi.fn();
    render(<><button id="wrong" onClick={wrong}>错误牌</button><button id="right" onClick={right}><span>指定牌</span></button><TutorialCoachmark {...base} onExit={exit} onSkip={skip} /></>);
    fireEvent.click(screen.getByText('错误牌')); expect(wrong).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('指定牌')); expect(right).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '退出演武' })); expect(exit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '跳过教学' })); expect(skip).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('键盘焦点留在允许目标和讲解中，阻止背景快捷键', () => {
    const keyboard = vi.fn();
    render(<div onKeyDown={keyboard}><button id="wrong">背景</button><button id="right">指定牌</button><TutorialCoachmark {...base} /></div>);
    const target = screen.getByText('指定牌'); target.focus();
    fireEvent.keyDown(target, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '退出演武' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(target);
    screen.getByText('背景').focus(); expect(document.activeElement).not.toBe(screen.getByText('背景'));
    fireEvent.keyDown(screen.getByText('背景'), { key: 'Enter' }); expect(keyboard).not.toHaveBeenCalled();
  });

  it('步骤切换立即采用新目标，释放事件和移动不被阻止', () => {
    const one = vi.fn(); const two = vi.fn(); const release = vi.fn(); const move = vi.fn();
    const view = (selector: string) => <><button id="right" onClick={one}>第一张</button><button id="second" onClick={two}>第二张</button><div data-testid="outside" onPointerUp={release} onPointerMove={move} /><TutorialCoachmark {...base} step={selector} selectors={[selector]} /></>;
    const { rerender } = render(view('#right'));
    rerender(view('#second'));
    fireEvent.click(screen.getByText('第一张')); fireEvent.click(screen.getByText('第二张'));
    expect(one).not.toHaveBeenCalled(); expect(two).toHaveBeenCalledOnce();
    fireEvent.pointerMove(screen.getByTestId('outside')); fireEvent.pointerUp(screen.getByTestId('outside'));
    expect(move).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });

  it('找不到目标仍能退出，并将说明气泡限制在320px屏幕内', () => {
    vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 568);
    const exit = vi.fn();
    render(<TutorialCoachmark {...base} selectors={['#missing']} onExit={exit} />);
    expect(screen.getByText(/正在定位/)).toBeTruthy();
    const bubble = screen.getByRole('region', { name: '教学提示' });
    expect(Number.parseFloat(bubble.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(bubble.style.left) + Number.parseFloat(bubble.style.width)).toBeLessThanOrEqual(312);
    fireEvent.click(screen.getByRole('button', { name: '退出演武' })); expect(exit).toHaveBeenCalledOnce();
  });

  it('真实详情对话框可读可关闭并被高亮', () => {
    const close = vi.fn();
    render(<><button id="right">指定牌</button><div role="dialog" aria-label="详情"><button onClick={close}>关闭详情</button></div><TutorialCoachmark {...base} /></>);
    fireEvent.click(screen.getByText('关闭详情')); expect(close).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-coachmark-outline="dialog"]')).toBeTruthy();
  });

  it('手机大对话框保留可读说明和出口，避开真正的关闭按钮', () => {
    vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 568);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'dialog') return rect(12, 12, 296, 544);
      if (this.textContent === '关闭详情') return rect(246, 24, 50, 44);
      return this.classList.contains('v2-coachmark-bubble') ? rect(0, 0, 304, 180) : rect();
    });
    render(<><div role="dialog"><button>关闭详情</button></div><TutorialCoachmark {...base} /></>);
    const bubble = screen.getByRole('region', { name: '教学提示' });
    expect(Number.parseFloat(bubble.style.maxHeight)).toBeGreaterThanOrEqual(180);
    expect(Number.parseFloat(bubble.style.top)).toBeGreaterThanOrEqual(80);
    expect(Number.parseFloat(bubble.style.top) + 180).toBeLessThanOrEqual(560);
  });

  it('目标滚动时刷新位置，卸载后不再限制背景事件', () => {
    const background = vi.fn();
    const { rerender } = render(<><button id="wrong" onClick={background}>背景</button><button id="right">指定牌</button><TutorialCoachmark {...base} /></>);
    vi.spyOn(screen.getByText('指定牌'), 'getBoundingClientRect').mockReturnValue(rect(120, 300));
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(document.querySelector('[data-coachmark-outline="target"]')?.getAttribute('x')).toBe('116');
    rerender(<button id="wrong" onClick={background}>背景</button>);
    fireEvent.click(screen.getByText('背景')); expect(background).toHaveBeenCalledOnce();
  });

  it('手机说明放在目标下方且不超出屏幕', () => {
    vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 568);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('v2-coachmark-bubble') ? rect(0, 0, 304, 180) : rect(180, 160, 100, 120);
    });
    render(<><button id="right">指定牌</button><TutorialCoachmark {...base} /></>);
    const bubble = screen.getByRole('region', { name: '教学提示' });
    const top = Number.parseFloat(bubble.style.top); const left = Number.parseFloat(bubble.style.left);
    expect(top).toBeGreaterThanOrEqual(292);
    expect(top + 180).toBeLessThanOrEqual(560);
    expect(left).toBeGreaterThanOrEqual(8); expect(left + 304).toBeLessThanOrEqual(312);
  });

  it('只在进入步骤时自动揭示第一个目标，允许原生滚动和触屏释放', () => {
    const scrollIntoView = vi.fn(); const touchMove = vi.fn(); const touchEnd = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('v2-coachmark-bubble') ? rect(0, 0, 300, 180) : rect(2000, 250);
    });
    render(<><button id="right">指定牌</button><button id="other">另一个奖励</button><div data-testid="scroll-surface" onTouchMove={touchMove} onTouchEnd={touchEnd} /><TutorialCoachmark {...base} selectors={['#right', '#other']} /></>);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    fireEvent.scroll(window); fireEvent.resize(window);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    fireEvent.touchMove(screen.getByTestId('scroll-surface')); fireEvent.touchEnd(screen.getByTestId('scroll-surface'));
    expect(touchMove).toHaveBeenCalledOnce(); expect(touchEnd).toHaveBeenCalledOnce();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('拖动步骤一次揭示同一横滑行内的源牌和目的格，不只保留源牌可见', () => {
    vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.id === 'drag-row') return rect(12, 350, 366, 174);
      const offset = document.getElementById('drag-row')?.scrollLeft ?? 0;
      if (this.id === 'drag-source') return rect(241 - offset, 350, 104, 174);
      if (this.id === 'drag-destination') return rect(15 - offset, 350, 104, 174);
      return rect(0, 0, 340, 180);
    });
    render(<><div id="drag-row" style={{ overflowX: 'auto' }} ref={row => {
      if (!row) return;
      row.scrollLeft = 80;
      Object.defineProperties(row, { clientWidth: { configurable: true, value: 366 }, scrollWidth: { configurable: true, value: 580 } });
    }}><button id="drag-destination">目的格</button><button id="drag-source">源牌</button></div><TutorialCoachmark {...base} drag selectors={['#drag-source', '#drag-destination']} /></>);
    const row = document.getElementById('drag-row')!;
    const destination = screen.getByText('目的格').getBoundingClientRect(); const source = screen.getByText('源牌').getBoundingClientRect();
    expect(row.scrollLeft).toBe(0);
    expect(destination.left).toBeGreaterThanOrEqual(12); expect(source.right).toBeLessThanOrEqual(378);
    expect(document.querySelectorAll('[data-coachmark-outline="target"]')).toHaveLength(2);
    expect(document.querySelector('.v2-coachmark-drag')).toBeTruthy();
    row.scrollLeft = 80; fireEvent.scroll(row);
    expect(row.scrollLeft).toBe(80);
  });

  it('320px横滑行可容纳三格时，不因额外安全边距放弃揭示拖动两端', () => {
    vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 568);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.id === 'compact-row') return rect(10, 200, 300, 134);
      const offset = document.getElementById('compact-row')?.scrollLeft ?? 0;
      if (this.id === 'compact-source') return rect(216 - offset, 200, 94, 134);
      if (this.id === 'compact-destination') return rect(10 - offset, 200, 94, 134);
      return rect(0, 0, 304, 180);
    });
    render(<><div id="compact-row" style={{ overflowX: 'auto' }} ref={row => {
      if (!row) return;
      row.scrollLeft = 80;
      Object.defineProperties(row, { clientWidth: { configurable: true, value: 300 }, scrollWidth: { configurable: true, value: 506 } });
    }}><button id="compact-destination">窄屏目的格</button><button id="compact-source">窄屏源牌</button></div><TutorialCoachmark {...base} drag selectors={['#compact-source', '#compact-destination']} /></>);
    expect(document.getElementById('compact-row')!.scrollLeft).toBe(0);
    expect(screen.getByText('窄屏目的格').getBoundingClientRect().left).toBeGreaterThanOrEqual(10);
    expect(screen.getByText('窄屏源牌').getBoundingClientRect().right).toBeLessThanOrEqual(310);
  });

  it('首次揭示手牌时为粘在底部的战斗操作栏留出空间，操作栏目标本身不滚动', () => {
    vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 568);
    const scrollBy = vi.fn(); vi.stubGlobal('scrollBy', scrollBy);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('v2-battle-actions')) return rect(10, 503, 300, 65);
      if (this.id === 'footer-play') return rect(160, 513, 140, 44);
      if (this.id === 'covered-card') return rect(20, 430, 94, 134);
      return rect(0, 0, 304, 180);
    });
    const view = (selector: string) => <><button id="covered-card">被遮住的牌</button><footer className="v2-battle-actions" style={{ position: 'sticky', bottom: 0 }}><button id="footer-play">出战</button></footer><TutorialCoachmark {...base} step={selector} selectors={[selector]} /></>;
    const { rerender } = render(view('#covered-card'));
    expect(scrollBy).toHaveBeenCalledWith({ top: 73, behavior: 'instant' });
    scrollBy.mockClear(); rerender(view('#footer-play'));
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
