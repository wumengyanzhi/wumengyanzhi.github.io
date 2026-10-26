/**
 * 品牌类型。
 *
 * 定义 ID、实例 ID 与节点 ID 在类型层面互相不可替换，避免把敌人 ID 当成卡牌 ID 传入。
 * 运行时退化为普通字符串，不增加序列化成本。
 */

declare const brand: unique symbol;

export type BrandedId<T extends string> = string & { readonly [brand]: T };

export type DefinitionId = BrandedId<'definition'>;
export type InstanceId = BrandedId<'instance'>;
export type RunNodeId = BrandedId<'run-node'>;

export function asDefinitionId(value: string): DefinitionId {
  return value as DefinitionId;
}

export function asInstanceId(value: string): InstanceId {
  return value as InstanceId;
}

export function asRunNodeId(value: string): RunNodeId {
  return value as RunNodeId;
}
