/**
 * 随机端口。
 *
 * 领域层只能通过本接口取得随机数，禁止调用 `Math.random()`。
 * 随机状态可序列化，因此可以被存档完整保存与恢复。
 */

export interface RngState {
  /** 初始种子，跨局不变。 */
  readonly seed: string;
  /** 已经消耗的随机次数，用于调试与重放比对。 */
  readonly cursor: number;
  /** 伪随机数发生器的内部状态，uint32。 */
  readonly stream: number;
}

export interface RngRoll {
  /** 落在 [0, 1) 区间内的随机值。 */
  readonly value: number;
  /** 本次消耗之后的随机状态，原状态不得被修改。 */
  readonly state: RngState;
}

export interface RngPort {
  /** 由种子建立初始随机状态。 */
  createState(seed: string): RngState;
  /** 取下一个 [0, 1) 随机值。 */
  next(state: RngState): RngRoll;
  /** 取下一个落在 [0, maxExclusive) 区间内的整数。 */
  nextInt(state: RngState, maxExclusive: number): RngRoll;
}
