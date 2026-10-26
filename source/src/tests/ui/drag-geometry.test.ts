import { describe, expect, it } from 'vitest';
import {
  PRESS_THRESHOLD,
  SNAP_TOLERANCE,
  type DropZone,
  distanceBetween,
  followDelta,
  grabOffset,
  passedThreshold,
  rectCenter,
  rectContains,
  rectDistance,
  resolveDrop,
} from '@ui/drag/snap';

/**
 * 拖拽几何的单测。
 *
 * 这一层不碰 DOM 也不碰 React，所以这里连 render 都不用，纯数字进纯数字出。
 * 界面集成测试（card-drag.test.tsx）负责「拖到的地方发出正确的命令」，
 * 这里负责「哪块地才算拖到了」——两者分工明确，别混。
 */

const rect = { x: 100, y: 200, width: 150, height: 200 };
const zones: readonly DropZone[] = [
  { kind: 'slot', index: 0, rect },
  { kind: 'slot', index: 1, rect: { x: 300, y: 200, width: 150, height: 200 } },
];

describe('矩形与坐标', () => {
  it('中心点落在两条边的中点上', () => {
    expect(rectCenter(rect)).toEqual({ x: 175, y: 300 });
  });

  it('边界上的点算落在矩形内，边界外一步就不算', () => {
    expect(rectContains(rect, { x: 100, y: 200 })).toBe(true);
    expect(rectContains(rect, { x: 250, y: 400 })).toBe(true);
    expect(rectContains(rect, { x: 99, y: 300 })).toBe(false);
    expect(rectContains(rect, { x: 175, y: 401 })).toBe(false);
  });

  it('矩形内部的点距离为零，角外按勾股数算', () => {
    expect(rectDistance(rect, { x: 175, y: 300 })).toBe(0);
    // 左上角外的点：横 5 竖 12，勾股得 13。
    expect(rectDistance(rect, { x: 95, y: 188 })).toBe(13);
  });

  it('两点距离走勾股定理', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('按下阈值', () => {
  it('不足阈值不算拖拽，够了才算', () => {
    const origin = { x: 10, y: 10 };
    expect(passedThreshold(origin, { x: 10 + PRESS_THRESHOLD - 1, y: 10 })).toBe(false);
    expect(passedThreshold(origin, { x: 10 + PRESS_THRESHOLD, y: 10 })).toBe(true);
  });

  it('斜着拖也算，看的是直线距离而不是单轴位移', () => {
    expect(passedThreshold({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false);
    expect(passedThreshold({ x: 0, y: 0 }, { x: 6, y: 8 })).toBe(true);
  });
});

describe('抓取偏移与跟随', () => {
  it('卡跟着点走，且手指与卡面的相对位置始终不变', () => {
    const offset = grabOffset(rect, { x: 140, y: 260 });
    expect(offset).toEqual({ x: 40, y: 60 });

    // 手指移到 400,360 时，卡片左上角应该在 360,300 ——相对位置还是 (40,60)。
    expect(followDelta(rect, { x: 400, y: 360 }, offset)).toEqual({ x: 260, y: 100 });
  });

  it('手指没动时位移为零', () => {
    const offset = grabOffset(rect, { x: 140, y: 260 });
    expect(followDelta(rect, { x: 140, y: 260 }, offset)).toEqual({ x: 0, y: 0 });
  });
});

describe('掉落区解析', () => {
  it('落在哪块区里就选哪块区，标记为内部命中', () => {
    const hit = resolveDrop(zones, rectCenter(zones[1]!.rect));
    expect(hit?.zone.index).toBe(1);
    expect(hit?.inside).toBe(true);
  });

  it('都没落进去时，选边缘最近的一块并带上距离', () => {
    const hit = resolveDrop(zones, { x: 275, y: 300 });
    expect(hit?.zone.index).toBe(0);
    expect(hit?.inside).toBe(false);
    expect(hit?.distance).toBe(25);
  });

  it('超出吸附容差就当作什么都没对准', () => {
    const justPast = rect.y + rect.height + SNAP_TOLERANCE + 1;
    expect(resolveDrop(zones, { x: 175, y: justPast })).toBeNull();
  });

  it('容差边界上仍然算命中', () => {
    const exactly = rect.y + rect.height + SNAP_TOLERANCE;
    const hit = resolveDrop(zones, { x: 175, y: exactly });
    expect(hit?.zone.index).toBe(0);
    expect(hit?.distance).toBe(SNAP_TOLERANCE);
  });

  it('区域重叠时取更小的那块，外层的大区抢不走命中', () => {
    const outer: DropZone = { kind: 'hand', index: 0, rect: { x: 0, y: 0, width: 800, height: 700 } };
    const hit = resolveDrop([outer, ...zones], rectCenter(rect));
    expect(hit?.zone.kind).toBe('slot');
    expect(hit?.zone.index).toBe(0);
  });

  it('没有任何区域时返回空，调用方据此让牌弹回原位', () => {
    expect(resolveDrop([], { x: 10, y: 10 })).toBeNull();
  });
});
