import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import { type MigrationStep, type SaveMigration } from './types';
import { migrateV0ToV1 } from './v0-to-v1';
import { migrateV1ToV2 } from './v1-to-v2';

export type { MigrationStep, SaveMigration };

/** 迁移链。按 `from` 升序排列，每一步的 `to` 必须等于下一步的 `from`。 */
export const MIGRATIONS: readonly SaveMigration[] = [
  {
    from: 0,
    to: 1,
    description: '补上缺失的存档版本号',
    apply: migrateV0ToV1,
  },
  {
    from: 1,
    to: 2,
    description: '补上出牌框装备目标表',
    apply: migrateV1ToV2,
  },
];

export const EARLIEST_SAVE_VERSION = MIGRATIONS[0]?.from ?? 0;

/**
 * 判断存档自称的版本。
 *
 * 没有 `meta.saveVersion` 的老导出一律算 v0，交给 v0→v1 处理；版本号不是整数时
 * 返回 null，因为无法据此选择迁移路径。
 */
export function detectSaveVersion(value: Readonly<Record<string, unknown>>): number | null {
  const meta = value.meta;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return 0;
  const raw = (meta as Record<string, unknown>).saveVersion;
  if (raw === undefined) return 0;
  return typeof raw === 'number' && Number.isSafeInteger(raw) ? raw : null;
}

export interface MigrationOutcome {
  readonly value: Record<string, unknown>;
  readonly fromVersion: number;
  readonly appliedMigrations: readonly string[];
}

/**
 * 把存档从自称版本一路升到 `targetVersion`。
 *
 * 版本高于目标值时拒绝向下兼容——未来的存档可能删掉了当前还在用的字段，
 * 假装能读会在后面炸得更隐蔽。
 */
export function migrateSave(
  value: Readonly<Record<string, unknown>>,
  targetVersion: number,
): Result<MigrationOutcome, AppError> {
  const detected = detectSaveVersion(value);
  if (detected === null) {
    return err(createAppError(AppErrorCode.SaveRejected, '存档版本号不是有效整数'));
  }
  if (detected > targetVersion) {
    return err(
      createAppError(AppErrorCode.SaveRejected, '存档版本高于当前程序支持的版本，请更新后再导入'),
    );
  }
  if (detected < EARLIEST_SAVE_VERSION) {
    return err(createAppError(AppErrorCode.SaveRejected, '存档版本过旧，无法迁移'));
  }

  let working: Record<string, unknown> = { ...value } as Record<string, unknown>;
  let version = detected;
  const applied: string[] = [];

  while (version < targetVersion) {
    const step = MIGRATIONS.find((migration) => migration.from === version);
    if (step === undefined) {
      return err(
        createAppError(AppErrorCode.SaveRejected, `缺少从版本 ${version} 到 ${targetVersion} 的迁移路径`),
      );
    }
    const meta = (working.meta ?? {}) as Readonly<Record<string, unknown>>;
    working = step.apply(working, meta);
    version = step.to;
    applied.push(`${step.from}→${step.to}`);
  }

  return ok({ value: working, fromVersion: detected, appliedMigrations: applied });
}
