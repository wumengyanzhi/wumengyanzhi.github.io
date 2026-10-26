import { describe, expect, it } from 'vitest';
import type { RngState } from '@domain/ports/rng-port';
import { createSeededRng } from '@infra/rng/seeded-rng';
import { hashSeedToUint32 } from '@infra/rng/mulberry32';

const rng = createSeededRng();

function takeValues(seed: string, count: number): number[] {
  let state = rng.createState(seed);
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const roll = rng.next(state);
    values.push(roll.value);
    state = roll.state;
  }
  return values;
}

describe('确定性随机', () => {
  it('相同种子产生相同序列', () => {
    expect(takeValues('battle-seed-001', 20)).toEqual(takeValues('battle-seed-001', 20));
  });

  it('不同种子产生不同序列', () => {
    expect(takeValues('battle-seed-001', 20)).not.toEqual(takeValues('battle-seed-002', 20));
  });

  it('随机值落在 [0, 1) 区间内', () => {
    for (const value of takeValues('range-check', 500)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('随机状态序列化后恢复，后续随机结果与中断前完全一致', () => {
    let straightState = rng.createState('resume-seed');
    const straight: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const roll = rng.next(straightState);
      straight.push(roll.value);
      straightState = roll.state;
    }

    let beforeSave = rng.createState('resume-seed');
    const collected: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const roll = rng.next(beforeSave);
      collected.push(roll.value);
      beforeSave = roll.state;
    }

    let restored: RngState = JSON.parse(JSON.stringify(beforeSave)) as RngState;
    expect(restored.cursor).toBe(5);
    while (collected.length < straight.length) {
      const roll = rng.next(restored);
      collected.push(roll.value);
      restored = roll.state;
    }

    expect(collected).toEqual(straight);
  });

  it('游标随消耗次数递增，原状态不被修改', () => {
    const state = rng.createState('immutable-seed');
    const roll = rng.next(state);
    expect(state.cursor).toBe(0);
    expect(roll.state.cursor).toBe(1);
    expect(roll.state.seed).toBe('immutable-seed');
    expect(roll.state.stream).not.toBe(state.stream);
  });

  it('nextInt 落在 [0, 上界) 区间内并覆盖多个取值', () => {
    let state = rng.createState('int-seed');
    const seen = new Set<number>();
    for (let index = 0; index < 300; index += 1) {
      const roll = rng.nextInt(state, 6);
      expect(Number.isInteger(roll.value)).toBe(true);
      expect(roll.value).toBeGreaterThanOrEqual(0);
      expect(roll.value).toBeLessThan(6);
      seen.add(roll.value);
      state = roll.state;
    }
    expect(seen.size).toBe(6);
  });

  it('nextInt 拒绝非正整数上界', () => {
    const state = rng.createState('guard-seed');
    expect(() => rng.nextInt(state, 0)).toThrow(RangeError);
    expect(() => rng.nextInt(state, 2.5)).toThrow(RangeError);
  });

  it('种子散列稳定且落在 uint32 范围内', () => {
    const first = hashSeedToUint32('three_kingdoms.run.three_battle_mvp');
    const second = hashSeedToUint32('three_kingdoms.run.three_battle_mvp');
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(4294967296);
  });
});
