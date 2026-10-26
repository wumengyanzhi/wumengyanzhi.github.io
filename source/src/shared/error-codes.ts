/**
 * 结构化错误码。
 *
 * 错误码、协议版本与枚举属于程序常量，不属于可平衡数值，因此保留在代码中而不是配置里。
 */

export const AppErrorCode = {
  /** 命令本身不合法，例如目标不在合法集合内。 */
  InvalidCommand: 'INVALID_COMMAND',
  /** 命令合法但当前状态下无法执行，例如次数已用尽。 */
  CommandRejected: 'COMMAND_REJECTED',
  /** 存储介质不可用，例如浏览器禁用了本地存储。 */
  StorageUnavailable: 'STORAGE_UNAVAILABLE',
  /** 写入失败，调用方应保留内存状态并提示玩家导出。 */
  StorageWriteFailed: 'STORAGE_WRITE_FAILED',
  /** 存档被拒绝载入，例如版本不兼容或引用了不存在的定义 ID。 */
  SaveRejected: 'SAVE_REJECTED',
  /** 配置验证未通过，例如字段越界、ID 重复或引用了不存在的定义。 */
  ConfigInvalid: 'CONFIG_INVALID',
  /** 效果结算被约束拦下，例如超出嵌套深度、自循环或目标非法。 */
  EffectRejected: 'EFFECT_REJECTED',
  /** 未归类的意外错误。 */
  Unknown: 'UNKNOWN',
} as const;

export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number>>;
}

export function createAppError(
  code: AppErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number>>,
): AppError {
  return details === undefined ? { code, message } : { code, message, details };
}
