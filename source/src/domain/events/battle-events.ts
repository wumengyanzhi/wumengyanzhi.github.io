import type { DefinitionId, InstanceId } from '../models/ids';

/**
 * 战斗事件。
 *
 * 界面只根据 GameState 渲染最终状态，并根据事件播放过程动画；
 * 动画完成回调不得重新执行领域规则。
 */
export type BattleEvent =
  | { readonly type: 'BattleStarted'; readonly enemyDefinitionId: DefinitionId; readonly maxHp: number }
  | { readonly type: 'CardsDrawn'; readonly instanceIds: readonly InstanceId[] }
  | { readonly type: 'CardsDiscarded'; readonly instanceIds: readonly InstanceId[] }
  | { readonly type: 'WeaponEquipped'; readonly weaponInstanceId: InstanceId; readonly targetInstanceId: InstanceId }
  | { readonly type: 'CardsPlayed'; readonly instanceIds: readonly InstanceId[]; readonly slotIndexes: readonly number[] }
  | { readonly type: 'MoraleGained'; readonly instanceId: InstanceId; readonly morale: number }
  | { readonly type: 'EffectResolved'; readonly sourceInstanceId: InstanceId; readonly effectId: string }
  | { readonly type: 'GoldGained'; readonly amount: number }
  | {
      readonly type: 'DamageResolved';
      readonly amount: number;
      readonly powerTotal: number;
      readonly ampTotal: number;
      readonly enemyHpAfter: number;
    }
  | { readonly type: 'DeckReshuffled'; readonly count: number }
  | { readonly type: 'BattleWon'; readonly enemyDefinitionId: DefinitionId }
  | { readonly type: 'BattleLost'; readonly enemyDefinitionId: DefinitionId };

export type BattleEventType = BattleEvent['type'];
