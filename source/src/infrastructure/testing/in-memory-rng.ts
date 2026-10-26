import type { RngPort, RngRoll, RngState } from '@domain/ports/rng-port';

/**
 * 测试用随机端口：按预设序列依次返回值，用于固定随机结果的规则测试。
 *
 * 序列耗尽时直接抛错，避免测试在静默补零的情况下通过。
 */
export function createInMemoryRng(values: readonly number[]): RngPort {
  function step(state: RngState): RngRoll {
    const index = state.stream;
    const value = values[index];
    if (value === undefined) {
      throw new RangeError(`InMemoryRng 的预设序列已耗尽：第 ${index + 1} 次调用没有对应值。`);
    }
    return {
      value,
      state: { seed: state.seed, cursor: state.cursor + 1, stream: index + 1 },
    };
  }

  return {
    createState(seed: string): RngState {
      return { seed, cursor: 0, stream: 0 };
    },
    next: step,
    nextInt(state: RngState, maxExclusive: number): RngRoll {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`nextInt 的上界必须是正整数，收到 ${maxExclusive}。`);
      }
      const roll = step(state);
      return { value: Math.floor(roll.value * maxExclusive), state: roll.state };
    },
  };
}
