import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { ConfigRegistry } from '@config/config-registry';
import type { StoragePort } from '@domain/ports/storage-port';
import { SAVE_VERSION, type GameState } from '@domain/state/game-state';
import { MAX_SAVE_CHARS } from './save-codec';
import { migrateSave } from './migrations';
import { describeFailure, validateSave } from './save-validator';

/**
 * 七步导入。
 *
 * 分成 plan 与 commit 两段是有意的：`plan` 一步都不碰存储，可以安全地「先看一眼」；
 * 只有 `commit` 才会动当前存档。任一步失败，当前存档与当前内存进度都必须保持原样。
 *
 * 步骤对齐《06-MVP开发计划》：
 * 1 读取不覆盖 → 2 格式与大小 → 3 版本与引用校验 → 4 迁移 → 5 内存重建并验证
 * → 6 备份当前存档 → 7 验证通过才替换
 */

export type ImportStep =
  | 'read'
  | 'format'
  | 'version'
  | 'migrate'
  | 'rebuild'
  | 'backup'
  | 'commit';

export interface ImportPlan {
  readonly state: GameState;
  readonly fromVersion: number;
  readonly appliedMigrations: readonly string[];
  readonly completedSteps: readonly ImportStep[];
}

export interface ImportOutcome extends ImportPlan {
  readonly backupTaken: boolean;
}

export interface ImporterDeps {
  readonly registry: ConfigRegistry;
  readonly storage: StoragePort;
  readonly saveKey: string;
  readonly backupKey: string;
}

export interface SaveImporter {
  /** 前五步：只读不写。调用它绝不会改动当前存档。 */
  plan(raw: string): Result<ImportPlan, AppError>;
  /** 后两步：备份当前存档，然后替换。 */
  commit(plan: ImportPlan): Result<ImportOutcome, AppError>;
  run(raw: string): Result<ImportOutcome, AppError>;
}

function reject(step: ImportStep, reason: string): AppError {
  return createAppError(AppErrorCode.SaveRejected, `${step}：${reason}`);
}

export function createImporter(deps: ImporterDeps): SaveImporter {
  const { registry, storage, saveKey, backupKey } = deps;

  return {
    plan(raw) {
      // 1 读取不覆盖：源字符串本身就是这段的内容，不触碰任何既有存档。
      if (raw.length === 0) return err(reject('read', '内容为空'));
      if (raw.length > MAX_SAVE_CHARS) return err(reject('read', '超过大小限制'));

      // 2 格式与大小解析必须是有效 JSON 对象。
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return err(reject('format', '不是有效 JSON'));
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return err(reject('format', '顶层不是对象'));
      }

      // 3 版本：高于当前版本的存档不能假装能读，必然缺当前还在用的字段。
      const migrated = migrateSave(parsed as Record<string, unknown>, SAVE_VERSION);
      if (!migrated.ok) return err(reject('version', migrated.error.message));

      // 4 迁移已在 migrateSave 内完成，这里只记账。
      const { value, fromVersion, appliedMigrations } = migrated.value;

      // 5 内存重建并验证：形状、分区、ID 引用一起过一遍。
      const validated = validateSave(value, registry);
      if (!validated.ok) return err(reject('rebuild', describeFailure(validated.error)));

      return ok({
        state: validated.value,
        fromVersion,
        appliedMigrations,
        completedSteps: ['read', 'format', 'version', 'migrate', 'rebuild'],
      });
    },

    commit(plan) {
      const previous = storage.read(saveKey);
      let backupTaken = false;

      // 6 备份当前存档：备份写不进去就不要往下走，否则失败后连回滚的凭据都没有。
      if (previous !== null) {
        const backup = storage.write(backupKey, previous);
        if (!backup.ok) return err(backup.error);
        backupTaken = true;
      }

      // 7 替换。写失败时把旧存档还原回去，保证失败前后主存档一致。
      const written = storage.write(saveKey, JSON.stringify(plan.state));
      if (!written.ok) {
        if (previous !== null) storage.write(saveKey, previous);
        return err(written.error);
      }

      return ok({
        state: plan.state,
        fromVersion: plan.fromVersion,
        appliedMigrations: plan.appliedMigrations,
        completedSteps: [...plan.completedSteps, 'backup', 'commit'],
        backupTaken,
      });
    },

    run(raw) {
      const planned = this.plan(raw);
      if (!planned.ok) return planned;
      return this.commit(planned.value);
    },
  };
}
