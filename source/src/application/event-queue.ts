import type { BattleEvent } from '@domain/events/battle-events';

/**
 * 事件队列。
 *
 * 有序、可消费、可清空。阶段九的动画系统与这里的队列共用同一份事件流：
 * 动画只消费事件做表现，播完不回写领域状态，因此关闭动画与开启动画的状态推进完全一致。
 */

export interface EventQueue {
  /** 入队一批事件，返回队列自身便于链式调用。 */
  push(events: readonly BattleEvent[]): EventQueue;
  /** 取出全部事件并清空队列；消费是破坏性的，取过即消失。 */
  drain(): readonly BattleEvent[];
  /** 只读查看当前内容，不清空。 */
  peek(): readonly BattleEvent[];
  clear(): void;
  readonly size: number;
}

export function createEventQueue(initial: readonly BattleEvent[] = []): EventQueue {
  let events: BattleEvent[] = [...initial];

  return {
    push(incoming) {
      events = [...events, ...incoming];
      return this;
    },
    drain() {
      const taken = events;
      events = [];
      return taken;
    },
    peek() {
      return events.slice();
    },
    clear() {
      events = [];
    },
    get size() {
      return events.length;
    },
  };
}
