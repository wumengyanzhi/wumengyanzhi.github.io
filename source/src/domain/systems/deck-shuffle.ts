import type { RngPort, RngState } from '../ports/rng-port';
import type { InstanceId } from '../models/ids';

/**
 * 洗牌与抽牌。
 *
 * 随机只能经过注入的 RngPort，保证相同种子与命令序列得到相同牌序。
 */
export interface ShuffleResult {
  readonly items: readonly InstanceId[];
  readonly rng: RngState;
}

export function shuffleInstances(
  list: readonly InstanceId[],
  rng: RngPort,
  state: RngState,
): ShuffleResult {
  const items = [...list];
  let rngState = state;
  for (let index = items.length - 1; index > 0; index -= 1) {
    const roll = rng.nextInt(rngState, index + 1);
    rngState = roll.state;
    const swapWith = roll.value;
    const current = items[index];
    const replacement = items[swapWith];
    if (current !== undefined && replacement !== undefined) {
      items[index] = replacement;
      items[swapWith] = current;
    }
  }
  return { items, rng: rngState };
}
