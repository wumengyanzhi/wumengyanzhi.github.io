import { createInstanceId, type DefinitionId, type InstanceId } from './ids';
import { createCardInstance, type CardInstance } from './card-instance';

/**
 * 卡牌实例工厂。
 *
 * MVP 初始牌组的 20 张卡各自生成独立实例，全局无重复定义卡。
 */
export function createCardInstances(
  definitionIds: readonly DefinitionId[],
  prefix = 'card',
): readonly CardInstance[] {
  return definitionIds.map((definitionId, index) =>
    createCardInstance(createInstanceId(prefix, index + 1), definitionId),
  );
}

export function indexInstancesById(
  instances: readonly CardInstance[],
): ReadonlyMap<InstanceId, CardInstance> {
  const map = new Map<InstanceId, CardInstance>();
  for (const instance of instances) {
    map.set(instance.instanceId, instance);
  }
  return map;
}
