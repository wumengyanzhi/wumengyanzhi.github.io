import { describe, expect, it } from 'vitest';
import { createInMemoryRng } from '@infra/testing/in-memory-rng';

describe('测试用随机端口', () => {
  it('按预设序列依次返回随机值', () => {
    const rng = createInMemoryRng([0.1, 0.5, 0.9]);
    const first = rng.next(rng.createState('fixed'));
    const second = rng.next(first.state);
    const third = rng.next(second.state);

    expect([first.value, second.value, third.value]).toEqual([0.1, 0.5, 0.9]);
    expect(third.state.cursor).toBe(3);
  });

  it('nextInt 同样消耗一次预设值', () => {
    const rng = createInMemoryRng([0.99]);
    const roll = rng.nextInt(rng.createState('fixed'), 10);
    expect(roll.value).toBe(9);
    expect(roll.state.cursor).toBe(1);
  });

  it('序列耗尽时抛错，避免测试静默通过', () => {
    const rng = createInMemoryRng([0.2]);
    const first = rng.next(rng.createState('fixed'));
    expect(() => rng.next(first.state)).toThrow(RangeError);
  });
});
