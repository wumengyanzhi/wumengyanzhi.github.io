import type { AppError } from '@shared/error-codes';
import type { Result } from '@shared/result';

/**
 * 键值存储端口。
 *
 * 领域层只能通过本接口访问持久化能力，不知道底层是本地存储还是 IndexedDB。
 * 写入失败必须返回结构化错误，不得静默成功，也不得直接抛出浏览器异常。
 */

export type StorageWriteResult = Result<void, AppError>;

export interface StoragePort {
  /** 读取键值；不存在时返回 null。 */
  read(key: string): string | null;
  /** 写入键值；失败时返回错误，调用方据此保留内存状态并提示导出。 */
  write(key: string, value: string): StorageWriteResult;
  /** 删除键值。 */
  remove(key: string): void;
}
