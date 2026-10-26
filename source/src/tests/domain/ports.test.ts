import { describe, expect, it } from 'vitest';
import type { StoragePort } from '@domain/ports/storage-port';
import { AppErrorCode, createAppError } from '@shared/error-codes';
import { asDefinitionId, asInstanceId } from '@shared/branded-id';
import { err, isErr, isOk, ok } from '@shared/result';
import { createFixedClock } from '@infra/testing/fixed-clock';
import { createSystemClock } from '@infra/clock/system-clock';
import { createMemoryStorage } from '@infra/testing/memory-storage';

describe('结构化结果', () => {
  it('ok 与 err 可以被类型守卫区分', () => {
    const success = ok(7);
    const failure = err(createAppError(AppErrorCode.InvalidCommand, '目标不合法'));

    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    expect(isOk(failure)).toBe(false);
    expect(isErr(failure)).toBe(true);
  });

  it('错误携带错误码与可读信息', () => {
    const error = createAppError(AppErrorCode.SaveRejected, '存档版本不兼容', { saveVersion: 9 });
    expect(error.code).toBe('SAVE_REJECTED');
    expect(error.details?.['saveVersion']).toBe(9);
  });
});

describe('时钟端口', () => {
  it('固定时钟始终返回同一时间戳', () => {
    const clock = createFixedClock(1_700_000_000_000);
    expect(clock.now()).toBe(1_700_000_000_000);
    expect(clock.now()).toBe(1_700_000_000_000);
  });

  it('系统时钟返回当前毫秒时间戳', () => {
    const value = createSystemClock().now();
    expect(value).toBeGreaterThan(1_600_000_000_000);
  });
});

describe('存储端口的内存实现', () => {
  it('读写删除行为与键值存储一致', () => {
    const storage: StoragePort = createMemoryStorage({ existing: 'value' });

    expect(storage.read('existing')).toBe('value');
    expect(storage.read('missing')).toBeNull();
    expect(isOk(storage.write('slot', 'payload'))).toBe(true);
    expect(storage.read('slot')).toBe('payload');

    storage.remove('slot');
    expect(storage.read('slot')).toBeNull();
  });

  it('写入成功时返回 ok，可供调用方区分失败', () => {
    const storage = createMemoryStorage();
    const result = storage.write('autosave', '{}');
    expect(result.ok).toBe(true);
    expect(storage.snapshot().get('autosave')).toBe('{}');
  });
});

describe('品牌类型', () => {
  it('运行期保持字符串语义，便于序列化', () => {
    const definitionId = asDefinitionId('three_kingdoms.character.shu_zhong_meng_shi');
    const instanceId = asInstanceId('card-instance-1');

    expect(definitionId.startsWith('three_kingdoms.')).toBe(true);
    expect(JSON.stringify({ definitionId, instanceId })).toContain('card-instance-1');
  });
});
