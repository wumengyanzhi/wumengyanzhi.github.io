import { describe, expect, it } from 'vitest';
import { createGameController } from '@app/game-controller';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createConfigRegistry } from '@config/config-registry';
import { createSeededRng } from '@infra/rng/seeded-rng';
import { startBattleWith, createPreparedState } from '../support/domain-fixture';
import { asDefinitionId, asRunNodeId } from '@domain/models/ids';
import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err } from '@shared/result';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;

describe('冒险命令与自动存档', () => {
  it('新开冒险生成固定牌组并保存完整状态与 RNG 游标', () => {
    const storage = createMemoryStorage();
    const controller = createGameController({ registry, storage, rng: createSeededRng() });
    const result = controller.dispatch({ type: 'NewRun', seed: 'save-seed' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.state.cards)).toHaveLength(20);
    expect(result.value.state.battle?.enemyMaxHp).toBe(1200);
    const saved = storage.read('three_kingdoms.autosave');
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!).rng).toEqual(result.value.state.rng);
  });

  it('摆牌和选择双侧武器目标都是可恢复的合法命令', () => {
    const storage = createMemoryStorage();
    const controller = createGameController({ registry, storage, rng: createSeededRng() });
    const started = controller.dispatch({ type: 'NewRun', seed: 'target-seed' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const hand = started.value.state.zones.hand;
    const characters = hand.filter((id) => {
      const card = started.value.state.cards[id];
      return card !== undefined && registry.getCardDefinition(card.definitionId)?.cardType === 'character';
    });
    const weapon = hand.find((id) => {
      const card = started.value.state.cards[id];
      return card !== undefined && registry.getCardDefinition(card.definitionId)?.cardType === 'weapon';
    });
    if (characters.length < 2 || weapon === undefined) throw new Error('测试起手没有双侧装备场景');
    expect(controller.dispatch({ type: 'StageCard', instanceId: characters[0]!, slotIndex: 0 }).ok).toBe(true);
    expect(controller.dispatch({ type: 'StageCard', instanceId: weapon, slotIndex: 1 }).ok).toBe(true);
    expect(controller.dispatch({ type: 'StageCard', instanceId: characters[1]!, slotIndex: 2 }).ok).toBe(true);
    const selected = controller.dispatch({
      type: 'SelectWeaponTarget',
      weaponInstanceId: weapon,
      targetInstanceId: characters[0]!,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value.state.equipmentTargets[weapon]).toBe(characters[0]);
    expect(JSON.parse(storage.read('three_kingdoms.autosave')!).equipmentTargets[weapon]).toBe(characters[0]);
    expect(selected.value.state.zones.hand).not.toContain(weapon);
  });

  it('第一战胜利进入三选一奖励，确认后进入第二战', () => {
    const base = startBattleWith(createPreparedState());
    const handId = base.zones.hand.find((id) => {
      const card = base.cards[id];
      return card !== undefined && registry.getCardDefinition(card.definitionId)?.cardType === 'character';
    });
    if (handId === undefined) throw new Error('起手没有人物卡');
    const boosted = {
      ...base,
      cards: { ...base.cards, [handId]: { ...base.cards[handId]!, permanentPower: 2000 } },
    };
    const controller = createGameController({
      registry,
      storage: createMemoryStorage(),
      rng: createSeededRng(),
      initialState: boosted,
    });
    const played = controller.dispatch({ type: 'Play', assignments: [{ slotIndex: 0, instanceId: handId }] });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.value.state.run.currentNodeId).toBe('three_kingdoms.run_node.after_huang_jin_reward');
    expect(played.value.state.run.gold).toBe(3);
    expect(played.value.state.pendingChoice?.kind).toBe('enhancement_reward');
    if (played.value.state.pendingChoice?.kind !== 'enhancement_reward') return;
    const candidateId = played.value.state.pendingChoice.candidates[0]?.id;
    if (candidateId === undefined) throw new Error('没有强化候选');
    const chosen = controller.dispatch({ type: 'ChooseEnhancement', candidateId });
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect(chosen.value.state.run.currentNodeId).toBe('three_kingdoms.run_node.xi_liang_battle');
    expect(chosen.value.state.battle?.enemyMaxHp).toBe(2200);
  });

  it('非法命令不写入存档，导入无效定义 ID 也不覆盖当前进度', () => {
    const storage = createMemoryStorage();
    const controller = createGameController({ registry, storage, rng: createSeededRng() });
    const started = controller.dispatch({ type: 'NewRun', seed: 'reject-seed' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const before = storage.read('three_kingdoms.autosave');
    const rejected = controller.dispatch({ type: 'ChooseEnhancement', candidateId: 'unknown' });
    expect(rejected.ok).toBe(false);
    expect(storage.read('three_kingdoms.autosave')).toBe(before);
    const invalid = JSON.parse(before!);
    const firstId = Object.keys(invalid.cards)[0];
    if (firstId === undefined) throw new Error('存档中没有卡牌');
    invalid.cards[firstId].definitionId = 'three_kingdoms.character.missing';
    const imported = controller.importSave(JSON.stringify(invalid));
    expect(imported.ok).toBe(false);
    expect(storage.read('three_kingdoms.autosave')).toBe(before);
  });

  it('第二战胜利进入第二次强化，之后进入 3600 生命的第三战', () => {
    const prepared = createPreparedState();
    const second = startBattleWith({
      ...prepared,
      run: {
        ...prepared.run,
        currentNodeId: asRunNodeId('three_kingdoms.run_node.xi_liang_battle'),
        battlesWon: 1,
      },
    }, asDefinitionId('three_kingdoms.enemy.xi_liang_tie_qi'), 100);
    const handId = second.zones.hand[0];
    if (handId === undefined) throw new Error('第二战起手为空');
    const controller = createGameController({
      registry,
      storage: createMemoryStorage(),
      rng: createSeededRng(),
      initialState: {
        ...second,
        cards: { ...second.cards, [handId]: { ...second.cards[handId]!, permanentPower: 2000 } },
      },
    });
    const played = controller.dispatch({ type: 'Play', assignments: [{ slotIndex: 0, instanceId: handId }] });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.value.state.pendingChoice?.kind).toBe('enhancement_reward');
    expect(played.value.state.run.currentNodeId).toBe('three_kingdoms.run_node.after_xi_liang_reward');
    const choice = played.value.state.pendingChoice;
    if (choice?.kind !== 'enhancement_reward') return;
    const selected = controller.dispatch({ type: 'ChooseEnhancement', candidateId: choice.candidates[0]!.id });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value.state.battle?.enemyMaxHp).toBe(3600);
    expect(selected.value.state.run.currentNodeId).toBe('three_kingdoms.run_node.hu_lao_battle');
  });

  it('第三战胜利结束冒险，不再生成奖励或敌人行动', () => {
    const prepared = createPreparedState();
    const third = startBattleWith({
      ...prepared,
      run: {
        ...prepared.run,
        currentNodeId: asRunNodeId('three_kingdoms.run_node.hu_lao_battle'),
        battlesWon: 2,
      },
    }, asDefinitionId('three_kingdoms.enemy.hu_lao_mo_jiang'), 100);
    const handId = third.zones.hand[0];
    if (handId === undefined) throw new Error('第三战起手为空');
    const controller = createGameController({
      registry,
      storage: createMemoryStorage(),
      rng: createSeededRng(),
      initialState: {
        ...third,
        cards: { ...third.cards, [handId]: { ...third.cards[handId]!, permanentPower: 2000 } },
      },
    });
    const played = controller.dispatch({ type: 'Play', assignments: [{ slotIndex: 0, instanceId: handId }] });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.value.state.run.status).toBe('won');
    expect(played.value.state.run.battlesWon).toBe(3);
    expect(played.value.state.pendingChoice).toBeNull();
    expect(played.value.state.battle?.status).toBe('won');
  });

  it('自动存档失败保留内存状态并允许导出', () => {
    const controller = createGameController({
      registry,
      rng: createSeededRng(),
      storage: {
        read: () => null,
        write: () => err(createAppError(AppErrorCode.StorageWriteFailed, '模拟写入失败')),
        remove: () => {},
      },
    });
    const started = controller.dispatch({ type: 'NewRun', seed: 'storage-fails' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.saveError?.code).toBe(AppErrorCode.StorageWriteFailed);
    expect(controller.state).toEqual(started.value.state);
    expect(controller.exportSave().ok).toBe(true);
  });
});
