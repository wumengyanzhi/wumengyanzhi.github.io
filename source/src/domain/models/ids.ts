import {
  asDefinitionId,
  asInstanceId,
  asRunNodeId,
  type DefinitionId,
  type InstanceId,
  type RunNodeId,
} from '@shared/branded-id';

/**
 * 领域 ID。
 *
 * 定义 ID、实例 ID 与节点 ID 互相不可替换；运行时仍是普通字符串，便于存档序列化。
 */

export type { DefinitionId, InstanceId, RunNodeId };
export { asDefinitionId, asInstanceId, asRunNodeId };

export function createInstanceId(prefix: string, index: number): InstanceId {
  return asInstanceId(`${prefix}-${index}`);
}

export function toDefinitionId(value: string): DefinitionId {
  return asDefinitionId(value);
}
