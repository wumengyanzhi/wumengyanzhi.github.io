/**
 * mulberry32 伪随机数发生器。
 *
 * 纯函数：给定内部状态返回随机值与下一个状态，不持有任何可变对象，
 * 因此同一状态在任何时刻都产生同一结果，可以随存档一起序列化。
 */

const STATE_STEP = 0x6d2b79f5;
const UINT32_RANGE = 4294967296;

export interface Mulberry32Step {
  readonly value: number;
  readonly state: number;
}

export function mulberry32Next(stream: number): Mulberry32Step {
  const nextState = (stream + STATE_STEP) | 0;
  let t = Math.imul(nextState ^ (nextState >>> 15), 1 | nextState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  return { value, state: nextState >>> 0 };
}

/**
 * FNV-1a 32 位散列：把任意种子字符串映射为稳定的 uint32 初始状态。
 */
export function hashSeedToUint32(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
