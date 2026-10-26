import { describe, expect, it } from 'vitest';
import { asDefinitionId } from '@domain/models/ids';
import { createCardDefinition } from '@domain/models/card-definition';
import {
  addPermanentStats,
  clearBattleState,
  createCardInstance,
  effectivePower,
  withZone,
} from '@domain/models/card-instance';
import { createCardInstances } from '@domain/models/card-instance-factory';
import { definitions, MVP_DECK_DEFINITION_IDS } from '../support/domain-fixture';

const mengShiId = asDefinitionId('three_kingdoms.character.shu_zhong_meng_shi');

describe('卡牌定义与实例', () => {
  it('定义被冻结，任何写操作都不生效', () => {
    const definition = definitions.get(mengShiId);
    expect(definition).toBeDefined();
    expect(Object.isFrozen(definition)).toBe(true);
    expect(() => {
      (definition as { basePower?: number }).basePower = 999;
    }).toThrow(TypeError);
  });

  it('同名卡牌的两个实例互相独立', () => {
    const instances = createCardInstances([mengShiId, mengShiId]);
    const [first, second] = instances;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    const reinforced = addPermanentStats(first, 20, 1);
    expect(effectivePower(reinforced)).toBe(20);
    expect(effectivePower(second)).toBe(0);
    expect(first.instanceId).not.toBe(second.instanceId);
    expect(reinforced.definitionId).toBe(second.definitionId);
  });

  it('本局永久强化跟随实例穿过牌区', () => {
    const instance = addPermanentStats(createCardInstance('i-1' as never, mengShiId), 15, 0);
    const inDiscard = withZone(instance, 'discardPile');
    expect(effectivePower(inDiscard)).toBe(15);
  });

  it('战斗结束只清除本场数据，永久强化保留', () => {
    const instance = {
      ...createCardInstance('i-2' as never, mengShiId),
    };
    const reinforced = addPermanentStats(instance, 10, 1);
    const cleaned = clearBattleState(reinforced);
    expect(cleaned.permanentPower).toBe(10);
    expect(cleaned.permanentAmp).toBe(1);
    expect(cleaned.morale).toBe(0);
    expect(cleaned.battleTemporaryPower).toBe(0);
  });

  it('MVP 牌组可以实例化为 20 个独立实例', () => {
    expect(createCardInstances(MVP_DECK_DEFINITION_IDS)).toHaveLength(20);
  });

  it('创建定义时携带效果配置且效果本身也被冻结', () => {
    const definition = definitions.get(asDefinitionId('three_kingdoms.tactic.lei_gu_jin_jun'));
    expect(definition?.effects).toHaveLength(1);
    expect(Object.isFrozen(definition?.effects[0])).toBe(true);
    expect(createCardDefinition).toBeTypeOf('function');
  });
});
