import { useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import type { InstanceId } from '@domain/models/ids';
import { useDrag } from './drag-context';
import type { DragSource } from './snap';

/**
 * 把一张牌变成可拖的手柄。
 *
 * 走的是一个很克制的手势序列：鼠标按下只记录起点，移动越过阈值才进入跟随，
 * 松手由上下文判定落点。没越过阈值时完全不干预原生 click，
 * 所以点选手牌、点格子收回这些原有操作一条都不受影响。
 *
 * 键盘路径另有其人（Tab 到卡面回车），这套手势只是鼠标玩家的加速键。
 */

export interface CardDragState {
  /** 正在跟随指针。 */
  readonly dragging: boolean;
  /** 刚刚落非法点，正在弹回原位。 */
  readonly rebounding: boolean;
  readonly style: CSSProperties;
  readonly status: '' | 'dragging' | 'rebound';
  readonly onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
}

export interface CardDragOptions {
  readonly instanceId: InstanceId;
  readonly source: DragSource;
  readonly disabled?: boolean;
}

export function useCardDrag({ instanceId, source, disabled = false }: CardDragOptions): CardDragState {
  const { begin, session, rebound, delta, enabled } = useDrag();
  const mine = session !== null && session.instanceId === instanceId;
  const dragging = mine && session.active === true;
  const rebounding = rebound !== null && rebound.instanceId === instanceId;

  const style = useMemo<CSSProperties>(() => {
    if (!dragging) return {};
    // 抬起来的手感＝放大一点点＋轻微倾斜，倾斜方向跟着横向位移走。
    const tilt = Math.max(-6, Math.min(6, delta.x / 14));
    return {
      transform: `translate3d(${delta.x}px, ${delta.y}px, 0) rotate(${tilt}deg) scale(1.04)`,
      zIndex: 60,
      transition: 'none',
    };
  }, [dragging, delta.x, delta.y]);

  function onMouseDown(event: ReactMouseEvent<HTMLElement>): void {
    if (disabled || !enabled) return;
    if (event.button !== 0) return;
    // 阻止原生拖影与文字选中，但保留 click：没越过阈值时仍由 click 完成选中与收回。
    event.preventDefault();
    begin(instanceId, source, event.currentTarget, { x: event.clientX, y: event.clientY });
  }

  const status: CardDragState['status'] = dragging ? 'dragging' : rebounding ? 'rebound' : '';
  return { dragging, rebounding, style, status, onMouseDown };
}
