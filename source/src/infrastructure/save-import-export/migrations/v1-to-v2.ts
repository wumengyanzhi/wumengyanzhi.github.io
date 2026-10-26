/**
 * 已有 v1 存档未持久化出牌框装备目标；v2 把它加入完整 GameState。
 * v1 只能在未选目标时保存，因此迁移后的目标表为空。
 */
export function migrateV1ToV2(
  legacy: Readonly<Record<string, unknown>>,
  meta: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    ...legacy,
    meta: { ...meta, saveVersion: 2 },
    equipmentTargets: {},
  };
}
