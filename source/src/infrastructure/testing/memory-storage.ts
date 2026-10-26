import type { StoragePort, StorageWriteResult } from '@domain/ports/storage-port';
import { ok } from '@shared/result';

/**
 * 测试用键值存储：内存 Map 实现，行为与本地存储一致（不存在返回 null）。
 */
export interface MemoryStorage extends StoragePort {
  /** 当前全部键值快照，供断言使用。 */
  snapshot(): ReadonlyMap<string, string>;
}

export function createMemoryStorage(initialEntries: Readonly<Record<string, string>> = {}): MemoryStorage {
  const entries = new Map<string, string>(Object.entries(initialEntries));

  return {
    read(key: string): string | null {
      const value = entries.get(key);
      return value === undefined ? null : value;
    },

    write(key: string, value: string): StorageWriteResult {
      entries.set(key, value);
      return ok(undefined);
    },

    remove(key: string): void {
      entries.delete(key);
    },

    snapshot(): ReadonlyMap<string, string> {
      return new Map(entries);
    },
  };
}
