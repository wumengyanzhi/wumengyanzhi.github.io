import type { RngPort, RngRoll, RngState } from '@domain/ports/rng-port';
import { hashSeedToUint32, mulberry32Next } from './mulberry32';

/**
 * 默认随机端口实现：种子 + 游标 + 内部流状态。
 *
 * 相同种子与相同调用次数必定得到相同序列；状态可以被 JSON 序列化，
 * 因此存档只要保存 RngState 就能精确恢复后续随机结果。
 */
export function createSeededRng(): RngPort {
  return {
    createState(seed: string): RngState {
      return { seed, cursor: 0, stream: hashSeedToUint32(seed) };
    },

    next(state: RngState): RngRoll {
      const step = mulberry32Next(state.stream);
      return {
        value: step.value,
        state: { seed: state.seed, cursor: state.cursor + 1, stream: step.state },
      };
    },

    nextInt(state: RngState, maxExclusive: number): RngRoll {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`nextInt 的上界必须是正整数，收到 ${maxExclusive}。`);
      }
      const step = mulberry32Next(state.stream);
      return {
        value: Math.floor(step.value * maxExclusive),
        state: { seed: state.seed, cursor: state.cursor + 1, stream: step.state },
      };
    },
  };
}
