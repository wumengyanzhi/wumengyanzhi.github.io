import type { InstanceId } from '@domain/models/ids';

/**
 * 拖拽几何。
 *
 * 这一层是纯函数：输入矩形与坐标，输出命中结果，不碰 DOM、不碰 React、不碰领域状态。
 * 之所以要抽出来，是因为「拖到哪算吸附成功」是唯一值得单测的部分，
 * 其余（跟随、提拉、回弹）都只是把它算出来的数字画出来。
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 掉落区种类：出牌框格子可以放牌，手牌区用于「拖回手牌」，其余区域一律算非法。 */
export type DropZoneKind = 'slot' | 'hand';

export interface DropZone {
  readonly kind: DropZoneKind;
  readonly index: number;
  readonly rect: Rect;
}

/** 卡片来源：决定落地时要发什么命令。 */
export type DragSource =
  | { readonly kind: 'hand' }
  | { readonly kind: 'slot'; readonly slotIndex: number };

/** 按下后要走够这么多像素才算拖拽，避免把点击当成拖。 */
export const PRESS_THRESHOLD = 6;

/** 松手时允许离目标矩形边缘这么远，超出就当没对准。 */
export const SNAP_TOLERANCE = 72;

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectContains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

/** 点到矩形外框的最短距离；落在矩形内记作 0。 */
export function rectDistance(rect: Rect, point: Point): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export function passedThreshold(origin: Point, current: Point, threshold = PRESS_THRESHOLD): boolean {
  return distanceBetween(origin, current) >= threshold;
}

/** 抓取点相对卡片左上角的偏移：拖拽时靠它保持手指与卡面的相对位置不变。 */
export function grabOffset(rect: Rect, origin: Point): Point {
  return { x: origin.x - rect.x, y: origin.y - rect.y };
}

/** 卡片跟随位移：左移 dx 上移 dy。 */
export function followDelta(rect: Rect, current: Point, offset: Point): Point {
  return { x: current.x - offset.x - rect.x, y: current.y - offset.y - rect.y };
}

export interface ResolvedDrop {
  readonly zone: DropZone;
  /** 松手点是否落在区域内；false 表示靠吸附容差拉过来的。 */
  readonly inside: boolean;
  readonly distance: number;
}

/**
 * 选掉落目标。
 *
 * 落在某个区域里优先（重叠时取矩形更小的那个，避免被外层的手牌区抢走）；
 * 都没落进去时，取边缘距离最近且在容差内的一块。
 */
export function resolveDrop(
  zones: readonly DropZone[],
  point: Point,
  tolerance = SNAP_TOLERANCE,
): ResolvedDrop | null {
  const inside = zones
    .filter((zone) => rectContains(zone.rect, point))
    .map((zone) => ({ zone, distance: rectDistance(zone.rect, point) }));
  if (inside.length > 0) {
    const best = inside.reduce((winner, candidate) => {
      const winnerArea = winner.zone.rect.width * winner.zone.rect.height;
      const candidateArea = candidate.zone.rect.width * candidate.zone.rect.height;
      return candidateArea < winnerArea ? candidate : winner;
    });
    return { zone: best.zone, inside: true, distance: 0 };
  }

  let best: ResolvedDrop | null = null;
  for (const zone of zones) {
    const distance = rectDistance(zone.rect, point);
    if (distance > tolerance) continue;
    if (best === null || distance < best.distance) best = { zone, inside: false, distance };
  }
  return best;
}

/** 一次拖拽会话：全是 UI State，手牌顺序与格位归属始终留在 GameState。 */
export interface DragSession {
  readonly instanceId: InstanceId;
  readonly source: DragSource;
  readonly origin: Point;
  readonly current: Point;
  readonly offset: Point;
  /** 已经越过阈值，开始跟随。 */
  readonly active: boolean;
  readonly hoverZone: DropZone | null;
  readonly hoverLegal: boolean;
}
