/**
 * 迁移 step：把一种存档结构变换成下一种。
 *
 * 迁移只做结构补全与字段改名，不做取值猜测——补不出来的字段留给校验器拒绝，
 * 好过把一个语义已经变化的存档悄悄塞进游戏。
 */
export type MigrationStep = (
  legacy: Readonly<Record<string, unknown>>,
  meta: Readonly<Record<string, unknown>>,
) => Record<string, unknown>;

export interface SaveMigration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  readonly apply: MigrationStep;
}
