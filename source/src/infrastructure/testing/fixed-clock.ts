import type { ClockPort } from '@domain/ports/clock-port';

/**
 * 测试用时钟：永远返回固定时间戳，使领域逻辑不依赖真实时间。
 */
export function createFixedClock(fixedNow: number): ClockPort {
  return {
    now(): number {
      return fixedNow;
    },
  };
}
