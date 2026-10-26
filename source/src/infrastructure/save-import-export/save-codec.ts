import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { ConfigRegistry } from '@config/config-registry';
import { SAVE_VERSION, type GameState } from '@domain/state/game-state';
import { migrateSave } from './migrations';
import { validateSave, describeFailure, type ValidationFailure } from './save-validator';

/** 单个存档的体积上限：超过后拒绝，避免恶意或 corrupt 文件拖死主线程。 */
export const MAX_SAVE_CHARS = 2_000_000;

export type { ValidationFailure };

export interface DecodeOutcome {
  readonly state: GameState;
  /** 原始版本号；等于 SAVE_VERSION 时表示没走过迁移。 */
  readonly fromVersion: number;
  readonly appliedMigrations: readonly string[];
}

export function encodeSave(state: GameState): string {
  return JSON.stringify(state);
}

function rejected(message: string): Result<DecodeOutcome, AppError> {
  return err(createAppError(AppErrorCode.SaveRejected, message));
}

/**
 * 解码一个存档字符串：大小与 JSON 检查 → 迁移到当前版本 → 逐分区校验。
 *
 * 顺序不能换。校验器假定输入已经是当前版本的结构，让它去读一个 v1 存档
 * 只会得到一堆与真实原因无关的「字段缺失」。
 */
export function decodeSave(raw: string, registry: ConfigRegistry): Result<DecodeOutcome, AppError> {
  if (raw.length === 0 || raw.length > MAX_SAVE_CHARS) {
    return rejected('存档为空或超过大小限制');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return rejected('存档不是有效 JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return rejected('存档不是对象');
  }

  const migrated = migrateSave(parsed as Record<string, unknown>, SAVE_VERSION);
  if (!migrated.ok) return err(migrated.error);

  const validated = validateSave(migrated.value.value, registry);
  if (!validated.ok) return rejected(describeFailure(validated.error));

  return ok({
    state: validated.value,
    fromVersion: migrated.value.fromVersion,
    appliedMigrations: migrated.value.appliedMigrations,
  });
}
