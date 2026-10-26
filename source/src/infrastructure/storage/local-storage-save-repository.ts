import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err, ok } from '@shared/result';
import type { StoragePort } from '@domain/ports/storage-port';

export function createLocalStorageSaveRepository(): StoragePort {
  return {
    read(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        window.localStorage.setItem(key, value);
        return ok(undefined);
      } catch {
        return err(createAppError(AppErrorCode.StorageWriteFailed, '本地存档写入失败'));
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // 浏览器禁止访问本地存储时，移除操作没有额外可恢复动作。
      }
    },
  };
}
