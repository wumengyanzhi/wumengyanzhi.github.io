/**
 * 时钟端口。
 *
 * 领域层只能通过本接口读取时间，禁止直接调用 `Date`。
 */

export interface ClockPort {
  /** 返回当前时间戳，单位为毫秒。 */
  now(): number;
}
