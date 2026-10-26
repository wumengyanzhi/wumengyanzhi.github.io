import { describe, expect, it } from 'vitest';
import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err } from '@shared/result';
import { createConfigRegistry, type ConfigRegistry } from '@config/config-registry';
import { createMemoryStorage, type MemoryStorage } from '@infra/testing/memory-storage';
import { createFixedClock } from '@infra/testing/fixed-clock';
import { createSeededRng } from '@infra/rng/seeded-rng';
import { createExporter } from '@infra/save-import-export/exporter';
import { createImporter, type SaveImporter } from '@infra/save-import-export/importer';
import { migrateSave } from '@infra/save-import-export/migrations';
import { migrateV0ToV1 } from '@infra/save-import-export/migrations/v0-to-v1';
import { migrateV1ToV2 } from '@infra/save-import-export/migrations/v1-to-v2';
import { MAX_SAVE_CHARS } from '@infra/save-import-export/save-codec';
import { validateSave } from '@infra/save-import-export/save-validator';
import type { GameState } from '@domain/state/game-state';
import { SAVE_VERSION } from '@domain/state/game-state';
import type { StoragePort } from '@domain/ports/storage-port';
import { createGameController } from '@app/game-controller';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry: ConfigRegistry = loaded.value;

const SAVE_KEY = 'autosave';
const BACKUP_KEY = 'autosave.backup';

function fixture(): { storage: MemoryStorage; importer: SaveImporter } {
  const storage = createMemoryStorage();
  return {
    storage,
    importer: createImporter({ registry, storage, saveKey: SAVE_KEY, backupKey: BACKUP_KEY }),
  };
}

function startedSave(): GameState {
  const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
  const started = controller.dispatch({ type: 'NewRun', seed: 'import-suite' });
  if (!started.ok) throw new Error(started.error.message);
  return started.value.state;
}

function mutate(recipe: (draft: Record<string, unknown>) => void): string {
  const draft = JSON.parse(JSON.stringify(startedSave())) as Record<string, unknown>;
  recipe(draft);
  return JSON.stringify(draft);
}

function messageOf(error: AppError): string {
  return error.message;
}

describe('迁移', () => {
  it('每个迁移都有固定样例：输入输出各自可断言', () => {
    const v1 = migrateV0ToV1(
      { run: { gold: 1 } },
      { appVersion: '0.0.1', contentVersion: 'legacy' },
    );
    expect(v1.meta).toEqual({ appVersion: '0.0.1', contentVersion: 'legacy', saveVersion: 1 });
    expect(v1.run).toEqual({ gold: 1 });

    const v2 = migrateV1ToV2(v1, v1.meta as Record<string, unknown>);
    expect((v2.meta as Record<string, unknown>).saveVersion).toBe(2);
    expect(v2.equipmentTargets).toEqual({});
  });

  it('迁移链把无版本号的 v0 存档一路升到当前版本', () => {
    const legacy = JSON.parse(mutate((draft) => {
      delete (draft.meta as Record<string, unknown>).saveVersion;
      delete draft.equipmentTargets;
    })) as Record<string, unknown>;
    const migrated = migrateSave(legacy, SAVE_VERSION);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.fromVersion).toBe(0);
    expect(migrated.value.appliedMigrations).toEqual(['0→1', '1→2']);
    expect((migrated.value.value.meta as Record<string, unknown>).saveVersion).toBe(SAVE_VERSION);
  });

  it('版本高于当前程序的存档被拒绝，不做降级读取', () => {
    const future = migrateSave({ meta: { saveVersion: SAVE_VERSION + 5 } }, SAVE_VERSION);
    expect(future.ok).toBe(false);
    if (future.ok) return;
    expect(future.error.code).toBe(AppErrorCode.SaveRejected);
  });
});

describe('七步导入', () => {
  it('plan 阶段一步都不碰存储', () => {
    const { storage, importer } = fixture();
    storage.write(SAVE_KEY, JSON.stringify(startedSave()));
    const before = storage.snapshot();

    const planned = importer.plan(mutate(() => {}));
    expect(planned.ok).toBe(true);
    expect(storage.snapshot()).toEqual(before);
  });

  it('导出后原样导入，GameState 深度相等', () => {
    const { importer } = fixture();
    const original = startedSave();
    const outcome = importer.run(JSON.stringify(original));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.state).toEqual(original);
    expect(outcome.value.fromVersion).toBe(SAVE_VERSION);
    expect(outcome.value.appliedMigrations).toEqual([]);
  });

  it('未知或过高的 saveVersion 被拒绝并给出说明', () => {
    const { importer } = fixture();
    const tooHigh = importer.run(mutate((draft) => {
      (draft.meta as Record<string, unknown>).saveVersion = SAVE_VERSION + 1;
    }));
    expect(tooHigh.ok).toBe(false);
    if (tooHigh.ok) return;
    expect(messageOf(tooHigh.error)).toContain('version');

    const notAnInteger = importer.run(mutate((draft) => {
      (draft.meta as Record<string, unknown>).saveVersion = 1.5;
    }));
    expect(notAnInteger.ok).toBe(false);
  });

  it('引用不存在定义 ID 的存档被拒绝', () => {
    const { importer } = fixture();
    const result = importer.run(mutate((draft) => {
      const cards = draft.cards as Record<string, Record<string, unknown>>;
      const first = Object.values(cards)[0];
      if (first === undefined) throw new Error('测试存档没有卡牌');
      first.definitionId = 'character.not-exist';
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(messageOf(result.error)).toContain('rebuild');
  });

  it('导入失败时当前存档与备份均保持不变', () => {
    const { storage, importer } = fixture();
    const existing = JSON.stringify(startedSave());
    storage.write(SAVE_KEY, existing);
    const before = storage.snapshot();

    const failed = importer.run('{ not json');
    expect(failed.ok).toBe(false);
    expect(storage.snapshot()).toEqual(before);
    expect(storage.read(SAVE_KEY)).toBe(existing);
    expect(storage.read(BACKUP_KEY)).toBeNull();
  });

  it('导入成功时先备份原存档再替换', () => {
    const { storage, importer } = fixture();
    const existing = JSON.stringify(startedSave());
    storage.write(SAVE_KEY, existing);

    const outcome = importer.run(mutate((draft) => {
      (draft.run as Record<string, unknown>).gold = 7;
    }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.backupTaken).toBe(true);
    expect(storage.read(BACKUP_KEY)).toBe(existing);
    expect(JSON.parse(storage.read(SAVE_KEY) ?? '{}')).toEqual(JSON.parse(JSON.stringify(outcome.value.state)));
  });

  it('主存档写入失败时回滚，旧存档仍在', () => {
    const inner = createMemoryStorage();
    const existing = JSON.stringify(startedSave());
    inner.write(SAVE_KEY, existing);
    let failSaveWrite = false;
    const failing: StoragePort = {
      read: (key) => inner.read(key),
      write: (key, value) => {
        if (failSaveWrite && key === SAVE_KEY) {
          return err(createAppError(AppErrorCode.StorageWriteFailed, '磁盘已满'));
        }
        return inner.write(key, value);
      },
      remove: (key) => inner.remove(key),
    };
    const importer = createImporter({ registry, storage: failing, saveKey: SAVE_KEY, backupKey: BACKUP_KEY });

    failSaveWrite = true;
    const result = importer.run(mutate(() => {}));
    expect(result.ok).toBe(false);
    expect(inner.read(SAVE_KEY)).toBe(existing);
  });

  it('超过大小限制的输入在读阶段就被挡下', () => {
    const { importer } = fixture();
    const result = importer.plan('x'.repeat(MAX_SAVE_CHARS + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(messageOf(result.error)).toContain('read');
  });
});

describe('导出器', () => {
  it('写出带版本三件套的文件名与内容', () => {
    const exporter = createExporter({ clock: createFixedClock(1_700_000_000_000) });
    const state = startedSave();
    const built = exporter.build(state);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.value.versions.appVersion).toBe(state.meta.appVersion);
    expect(built.value.versions.contentVersion).toBe(state.meta.contentVersion);
    expect(built.value.versions.saveVersion).toBe(SAVE_VERSION);
    expect(built.value.filename).toContain(`v${SAVE_VERSION}`);
    expect(JSON.parse(built.value.content)).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it('版本信息与当前程序不一致时拒绝导出', () => {
    const exporter = createExporter({ clock: createFixedClock(0) });
    const state = startedSave();
    const stale = { ...state, meta: { ...state.meta, saveVersion: SAVE_VERSION - 1 } };
    expect(exporter.build(stale).ok).toBe(false);
  });
});

describe('自动存档', () => {
  it('写入失败时不静默覆盖，且仍可导出当前内存进度', () => {
    const storage = createMemoryStorage();
    let rejecting = false;
    const failing: StoragePort = {
      read: (key) => storage.read(key),
      write: (key, value) => (rejecting
        ? err(createAppError(AppErrorCode.StorageWriteFailed, '磁盘已满'))
        : storage.write(key, value)),
      remove: (key) => storage.remove(key),
    };
    const controller = createGameController({ registry, storage: failing, rng: createSeededRng() });

    const started = controller.dispatch({ type: 'NewRun', seed: 'autosave-first' });
    expect(started.ok).toBe(true);
    const savedWhileHealthy = storage.read('three_kingdoms.autosave');
    expect(savedWhileHealthy).not.toBeNull();

    rejecting = true;
    const afterFailure = controller.dispatch({ type: 'NewRun', seed: 'autosave-fail' });
    expect(afterFailure.ok).toBe(true);
    if (!afterFailure.ok) return;
    expect(afterFailure.value.saveError?.code).toBe(AppErrorCode.StorageWriteFailed);
    // 失败的写入没有把上次成功的存档覆盖掉。
    expect(storage.read('three_kingdoms.autosave')).toBe(savedWhileHealthy);

    const exportable = controller.exportSave();
    expect(exportable.ok).toBe(true);
    if (!exportable.ok) return;
    expect(JSON.parse(exportable.value.content))
      .toEqual(JSON.parse(JSON.stringify(afterFailure.value.state)));
  });

  it('任意合法命令提交并重新载入后，状态与下一次随机结果均与中断前一致', () => {
    const storage = createMemoryStorage();
    const first = createGameController({ registry, storage, rng: createSeededRng() });
    const started = first.dispatch({ type: 'NewRun', seed: 'resume-continuity' });
    if (!started.ok) throw new Error(started.error.message);
    const reference = first.state;
    if (reference === null) throw new Error('缺少当前状态');

    const second = createGameController({ registry, storage, rng: createSeededRng() });
    const resumed = second.resume();
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value).toEqual(reference);

    const rng = createSeededRng();
    expect(rng.next(resumed.value.rng)).toEqual(rng.next(reference.rng));
  });
});

describe('校验器分区', () => {
  it('report 精确的失败阶段，而不是笼统报错', () => {
    const valid = JSON.parse(JSON.stringify(startedSave())) as Record<string, unknown>;
    (valid.history as unknown[]).push({ kind: 'nope', type: 'X', payload: {} });
    const result = validateSave(valid, registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('history');
  });

  it('缺 contentVersion 的老存档即使迁移过也被拒绝', () => {
    const raw = migrateSave(
      { meta: { appVersion: 'legacy' }, run: {}, rng: {}, cards: {}, zones: {} },
      SAVE_VERSION,
    );
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    expect(validateSave(raw.value.value, registry).ok).toBe(false);
  });
});
