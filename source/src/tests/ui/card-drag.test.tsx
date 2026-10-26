import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createGameController, type GameController } from '@app/game-controller';
import { createConfigRegistry } from '@config/config-registry';
import type { InstanceId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;

afterEach(cleanup);

/**
 * 拖拽这一路：从手牌甩进空格、甩到非法处弹回、框内换位。
 *
 * 真正要守住的是「拖到哪里＝发什么命令」这件事本身，
 * 所以每条例 Assert 都直接看 GameState，而不是看界面有没有动。
 * 拖拽层不认识 DOM 结构，只认 data-drop-zone；这里就用同一套属性喂它坐标。
 */

const SLOT_ORIGIN = { x: 100, y: 200 };
const SLOT_SIZE = { width: 150, height: 200 };
const SLOT_PITCH = 190;
const HAND_CARD = { x: 300, y: 560, width: 128, height: 180 };

function slotRect(index: number): { x: number; y: number; width: number; height: number } {
  return { x: SLOT_ORIGIN.x + index * SLOT_PITCH, y: SLOT_ORIGIN.y, ...SLOT_SIZE };
}

function centerOf(rect: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** jsdom 没有排版，出牌框的坐标只能我们自己给；断言用的还是真实 GameState。 */
function installLayout(): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function fakeRect(this: HTMLElement): DOMRect {
    let box = { x: 0, y: 0, width: 0, height: 0 };
    if (this.hasAttribute('data-drop-zone')) {
      box = slotRect(Number(this.getAttribute('data-drop-index') ?? '0'));
    } else if (this.classList.contains('hand__card')) {
      box = HAND_CARD;
    } else if (this.classList.contains('play-slot__hold')) {
      const frame = this.closest('[data-drop-zone]');
      box = frame === null ? box : slotRect(Number(frame.getAttribute('data-drop-index') ?? '0'));
    }
    return {
      x: box.x,
      y: box.y,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
      width: box.width,
      height: box.height,
      toJSON: () => box,
    } as DOMRect;
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

interface Harness {
  readonly controller: GameController;
  readonly current: () => GameState;
  readonly handCard: (index: number) => HTMLElement;
  readonly slotHold: (index: number) => HTMLElement;
}

function boot(): Harness {
  const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
  render(<App controller={controller} registry={registry} />);
  fireEvent.click(screen.getByRole('button', { name: '新开冒险' }));
  return {
    controller,
    current: () => {
      const state = controller.state;
      if (state === null) throw new Error('本局未创建');
      return state;
    },
    handCard: (index) => screen.getAllByTestId('hand-card')[index]!.parentElement as HTMLElement,
    slotHold: (index) => screen.getAllByTestId('play-slot')[index]!.closest('.play-slot__hold') as HTMLElement,
  };
}

function stageByClick(app: Harness, instanceId: InstanceId, slotIndex: number): void {
  // 每次都重新问当前手牌的序号：放走一张之后，后面的排位会整体前移。
  const index = app.current().zones.hand.indexOf(instanceId);
  fireEvent.click(screen.getAllByTestId('hand-card')[index]!);
  fireEvent.click(screen.getAllByTestId('play-slot')[slotIndex]!);
}

/** 一次完整的拖：按下 → 越过阈值成型 → 走向目标 → 松手。 */
function drag(from: HTMLElement, stops: readonly { readonly x: number; readonly y: number }[]): void {
  const start = stops[0]!;
  fireEvent.mouseDown(from, { button: 0, clientX: start.x, clientY: start.y });
  for (const stop of stops.slice(1)) {
    fireEvent.mouseMove(window, { clientX: stop.x, clientY: stop.y });
  }
  const last = stops[stops.length - 1]!;
  fireEvent.mouseUp(window, { clientX: last.x, clientY: last.y });
}

describe('拖拽摆牌', () => {
  it('手牌甩进空格＝一次摆牌命令，牌从手牌进到那一格', () => {
    const restore = installLayout();
    try {
      const app = boot();
      const target = app.current().zones.hand[0]!;
      const handBefore = [...app.current().zones.hand];

      drag(app.handCard(0), [centerOf(HAND_CARD), { x: 364, y: 638 }, centerOf(slotRect(2))]);

      expect(app.current().zones.playSlots[2]).toBe(target);
      expect(app.current().zones.hand).not.toContain(target);
      expect(app.current().zones.hand).toHaveLength(handBefore.length - 1);
    } finally {
      restore();
    }
  });

  it('甩到已占格＝非法，不产生任何命令并标记回弹', () => {
    const restore = installLayout();
    try {
      const app = boot();
      const hand = [...app.current().zones.hand];
      stageByClick(app, hand[0]!, 1);
      const afterPlate = app.current();
      expect(afterPlate.zones.playSlots[1]).toBe(hand[0]);

      const before = JSON.stringify(afterPlate.zones);
      drag(app.handCard(0), [centerOf(HAND_CARD), { x: 364, y: 638 }, centerOf(slotRect(1))]);

      expect(JSON.stringify(app.current().zones)).toBe(before);
      expect(document.querySelector('[data-drag="rebound"]')).not.toBeNull();
    } finally {
      restore();
    }
  });

  it('甩到框外＝没发生拖拽，牌留在手上并弹回原位', () => {
    const restore = installLayout();
    try {
      const app = boot();
      const target = app.current().zones.hand[3]!;
      const before = JSON.stringify(app.current().zones);

      drag(app.handCard(3), [centerOf(HAND_CARD), { x: 364, y: 638 }, { x: 4, y: 4 }]);

      expect(JSON.stringify(app.current().zones)).toBe(before);
      expect(app.current().zones.hand).toContain(target);
      expect(document.querySelector('[data-drag="rebound"]')).not.toBeNull();
    } finally {
      restore();
    }
  });

  it('框内换格：牌从一格移到另一格，GameState 的出牌框顺序随之改变', () => {
    const restore = installLayout();
    try {
      const app = boot();
      const hand = [...app.current().zones.hand];
      stageByClick(app, hand[0]!, 0);
      stageByClick(app, hand[1]!, 2);

      const before = app.current();
      expect(before.zones.playSlots[0]).toBe(hand[0]);
      expect(before.zones.playSlots[2]).toBe(hand[1]);

      drag(app.slotHold(0), [centerOf(slotRect(0)), { x: 175, y: 250 }, centerOf(slotRect(1))]);

      const after = app.current();
      expect(after.zones.playSlots[0]).toBeNull();
      expect(after.zones.playSlots[1]).toBe(hand[0]);
      expect(after.zones.playSlots[2]).toBe(hand[1]);
      // 换格不消耗出战次数，也不改变第五格之后的外界顺序。
      expect(after.battle?.playCountRemaining).toBe(before.battle?.playCountRemaining);
    } finally {
      restore();
    }
  });

  it('按下但没越过阈值时不算拖拽，click 照常选中这张牌', () => {
    const restore = installLayout();
    try {
      const app = boot();
      const card = app.current().zones.hand[0]!;
      const start = centerOf(HAND_CARD);

      fireEvent.mouseDown(app.handCard(0), { button: 0, clientX: start.x, clientY: start.y });
      fireEvent.mouseMove(window, { clientX: start.x + 2, clientY: start.y + 1 });
      fireEvent.mouseUp(window, { clientX: start.x + 2, clientY: start.y + 1 });
      fireEvent.click(screen.getAllByTestId('hand-card')[0]!);
      fireEvent.click(screen.getAllByTestId('play-slot')[4]!);

      expect(app.current().zones.playSlots[4]).toBe(card);
    } finally {
      restore();
    }
  });
});

/**
 * 层级与裁剪。
 *
 * 手牌带与出牌框都是 overflow: hidden 的带子，而牌要跨带子飞；
 * 不解除裁剪，被拿起来的牌就会在带子边界被切掉——玩家看到的是「牌压在空位下面」。
 * jsdom 不做排版，所以这里守住两件能被证明的事：标记的时机，以及样式里确实有解裁剪的规则。
 */
describe('拖拽时的裁剪', () => {
  const motionCss = readFileSync(resolve(process.cwd(), 'src/ui/styles/motion.css'), 'utf8');

  it('越过阈值才打解除裁剪的标记，松手立刻撤销', () => {
    const restore = installLayout();
    try {
      const app = boot();
      const start = centerOf(HAND_CARD);

      fireEvent.mouseDown(app.handCard(0), { button: 0, clientX: start.x, clientY: start.y });
      expect(document.documentElement.getAttribute('data-dragging')).toBeNull();

      // 按下后只挪一点点：还没成型，不该动任何裁剪行为。
      fireEvent.mouseMove(window, { clientX: start.x + 2, clientY: start.y + 1 });
      expect(document.documentElement.getAttribute('data-dragging')).toBeNull();

      fireEvent.mouseMove(window, { clientX: start.x + 40, clientY: start.y - 80 });
      expect(document.documentElement.getAttribute('data-dragging')).toBe('true');

      fireEvent.mouseUp(window, { clientX: start.x + 40, clientY: start.y - 80 });
      expect(document.documentElement.getAttribute('data-dragging')).toBeNull();
    } finally {
      restore();
    }
  });

  it('手牌带、手牌行与出牌框在拖拽期间都解除裁剪', () => {
    for (const selector of ['.hand', '.hand__row', '.field']) {
      expect(motionCss).toContain(`html[data-dragging="true"] ${selector}`);
    }
  });

  it('原位不再用跟着牌飞的半透明遮罩压暗卡面', () => {
    expect(motionCss).not.toContain('.hand__card[data-drag="dragging"]::after');
  });
});
