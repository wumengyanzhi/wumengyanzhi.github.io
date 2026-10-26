import type { MigrationStep } from './types';

/**
 * v0 → v1。
 *
 * v0 是最早期的导出：有 meta 但没有 `saveVersion` 字段。这一步只把它标成 1，
 * 不替它编造 `contentVersion`——版本对不上的存档应该在校验阶段被明确拒绝，
 * 而不是被迁移函数伪装成兼容。
 */
export const migrateV0ToV1: MigrationStep = (legacy, meta) => ({
  ...legacy,
  meta: { ...meta, saveVersion: 1 },
});
