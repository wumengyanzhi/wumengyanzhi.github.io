import type { ClockPort } from '@domain/ports/clock-port';

/**
 * 浏览器时钟适配器：唯一允许直接读取系统时间的实现。
 */
export function createSystemClock(): ClockPort {
  return {
    now(): number {
      return Date.now();
    },
  };
}
