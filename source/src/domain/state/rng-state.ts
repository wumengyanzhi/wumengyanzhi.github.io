import type { RngState } from '../ports/rng-port';

/**
 * 随机状态切片。
 *
 * 存档必须保存种子与游标，使重新载入后的下一次随机结果与中断前一致。
 */
export type { RngState };

export interface RngStateSlice {
  readonly rng: RngState;
}

export function withRngState<T extends RngStateSlice>(base: T, rng: RngState): T {
  return { ...base, rng };
}
