import type { CardDefinition } from '@domain/models/card-definition';
import type { DefinitionId, InstanceId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';
import { buildCardFace, type CardFace } from './card-face';

/**
 * 卡面工厂。
 *
 * 界面组件只吃 CardFace，因此这里统一把「GameState 里的实例 + 定义表的静态数据」
 * 合成一张可渲染的卡面。Harry: 找不到定义就返回 null，由调用方决定降级显示，
 * 绝不用占位数值假装这张牌存在。
 */

export type DefinitionMap = ReadonlyMap<DefinitionId, CardDefinition>;

export function faceOf(state: GameState, definitions: DefinitionMap, instanceId: InstanceId): CardFace | null {
  const instance = state.cards[instanceId];
  if (instance === undefined) return null;
  return buildCardFace(instance, definitions.get(instance.definitionId));
}

export function facesOf(
  state: GameState,
  definitions: DefinitionMap,
  instanceIds: readonly InstanceId[],
): readonly CardFace[] {
  const faces: CardFace[] = [];
  for (const instanceId of instanceIds) {
    const face = faceOf(state, definitions, instanceId);
    if (face !== null) faces.push(face);
  }
  return faces;
}

/** 出牌框：null 必须原样保留——空位本身就是规则的一部分。 */
export function slotFaces(state: GameState, definitions: DefinitionMap): readonly (CardFace | null)[] {
  return state.zones.playSlots.map((instanceId) =>
    instanceId === null || instanceId === undefined ? null : faceOf(state, definitions, instanceId),
  );
}
