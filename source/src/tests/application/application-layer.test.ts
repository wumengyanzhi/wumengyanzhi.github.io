import { describe, expect, it } from 'vitest';
import { createConfigRegistry } from '@config/config-registry';
import { createGameController, type GameCommand, type GameController } from '@app/game-controller';
import { createEventQueue } from '@app/event-queue';
import { validateCommand } from '@app/command-validation';
import {
  selectDamagePreview,
  selectEmptySlotIndexes,
  selectHand,
  selectPlaySlots,
  selectResources,
  selectWeaponTargetCandidates,
} from '@app/selectors';
import { AppErrorCode } from '@shared/error-codes';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';
import type { GameState } from '@domain/state/game-state';
import type { BattleEvent } from '@domain/events/battle-events';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;

function controller(): GameController {
  return createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
}

function started(seed = 'phase6-seed'): { c: GameController; state: GameState } {
  const c = controller();
  const result = c.dispatch({ type: 'NewRun', seed });
  if (!result.ok) throw new Error('新开冒险失败');
  return { c, state: result.value.state };
}

/** 起手摆三张到出牌框，返回用到的命令，供重放比对。 */
function stagingCommands(state: GameState): GameCommand[] {
  return state.zones.hand.slice(0, 3).map((instanceId, index) => ({
    type: 'StageCard' as const,
    instanceId,
    slotIndex: index,
  }));
}

describe('事件队列', () => {
  it('入队保序、取出后清空、可窥视也可清空', () => {
    const queue = createEventQueue();
    const a: BattleEvent = { type: 'CardsDrawn', instanceIds: [] };
    const b: BattleEvent = { type: 'DeckReshuffled', count: 1 };
    queue.push([a]).push([b]);
    expect(queue.size).toBe(2);
    expect(queue.peek()).toEqual([a, b]);
    expect(queue.size).toBe(2);
    expect(queue.drain()).toEqual([a, b]);
    expect(queue.size).toBe(0);
    queue.push([a]);
    queue.clear();
    expect(queue.size).toBe(0);
  });
});

describe('命令预检', () => {
  it('没有进行中的冒险时除新开之外全部拒绝', () => {
    const result = validateCommand(null, { type: 'Discard', instanceIds: [] }, {
      economy: registry.config.economy,
      weaponCandidates: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(AppErrorCode.CommandRejected);
  });

  it('冒险已结束时拒绝后续命令', () => {
    const { state } = started();
    const finished: GameState = { ...state, run: { ...state.run, status: 'won' } };
    const result = validateCommand(finished, { type: 'Discard', instanceIds: [] }, {
      economy: registry.config.economy,
      weaponCandidates: [],
    });
    expect(result.ok).toBe(false);
  });

  it('存在待处理选择时，只有解决该选择的命令被放行', () => {
    const { state } = started();
    const pending: GameState = {
      ...state,
      pendingChoice: {
        kind: 'enhancement_reward',
        stageId: 'stage',
        candidates: [{ id: 'c1', targetInstanceId: state.zones.hand[0]!, tier: 'common', attribute: 'power', amount: 5, skillId: null }],
      },
    };
    const blocked = validateCommand(pending, { type: 'Discard', instanceIds: [] }, {
      economy: registry.config.economy,
      weaponCandidates: [],
    });
    expect(blocked.ok).toBe(false);

    const allowed = validateCommand(pending, { type: 'ChooseEnhancement', candidateId: 'c1' }, {
      economy: registry.config.economy,
      weaponCandidates: [],
    });
    expect(allowed.ok).toBe(true);
  });

  it('刷新预检拦住金币不足与次数用尽', () => {
    const { state } = started();
    const base: GameState = {
      ...state,
      pendingChoice: { kind: 'enhancement_reward', stageId: 'stage', candidates: [] },
    };
    const poor = validateCommand({ ...base, run: { ...base.run, gold: 0 } }, { type: 'RerollEnhancement' }, {
      economy: registry.config.economy,
      weaponCandidates: [],
    });
    expect(poor.ok).toBe(false);
    if (poor.ok) return;
    expect(poor.error.message).toContain('金币不足');

    const exhausted = validateCommand(
      { ...base, run: { ...base.run, rerollsUsed: registry.config.economy.maxRerollsPerStage } },
      { type: 'RerollEnhancement' },
      { economy: registry.config.economy, weaponCandidates: [] },
    );
    expect(exhausted.ok).toBe(false);
    if (exhausted.ok) return;
    expect(exhausted.error.message).toContain('刷新次数');
  });

  it('选择强化时拒绝不在候选列表里的 ID', () => {
    const { state } = started();
    const pending: GameState = {
      ...state,
      pendingChoice: { kind: 'enhancement_reward', stageId: 'stage', candidates: [] },
    };
    const result = validateCommand(pending, { type: 'ChooseEnhancement', candidateId: 'unknown' }, {
      economy: registry.config.economy,
      weaponCandidates: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe('全有或全无提交', () => {
  it('非法命令不改变任何状态，只返回错误码与原因', () => {
    const { c, state } = started();
    const before = c.state;
    const rejected = c.dispatch({ type: 'StageCard', instanceId: state.zones.hand[0]!, slotIndex: 99 });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe(AppErrorCode.InvalidCommand);
    expect(rejected.error.message).not.toBe('');
    expect(c.state).toBe(before);
  });

  it('领域拒绝的命令同样不推进状态', () => {
    const { c, state } = started();
    const before = c.state;
    // 出牌框为空时出战：领域会拒绝，状态必须原样保留。
    const rejected = c.dispatch({ type: 'Play', assignments: [] });
    expect(rejected.ok).toBe(false);
    expect(c.state).toBe(before);
    expect(state.zones.playSlots.every((slot) => slot === null)).toBe(true);
  });
});

describe('确定性重放', () => {
  it('同种子同命令序列的两次运行状态与事件序列完全一致', () => {
    const first = controller();
    const firstStart = first.dispatch({ type: 'NewRun', seed: 'replay-seed' });
    if (!firstStart.ok) throw new Error('第一次新开冒险失败');
    const script: GameCommand[] = [
      ...stagingCommands(firstStart.value.state),
      { type: 'Play', assignments: [] },
    ];
    // Play 的 assignments 必须来自摆牌后的实际出牌框，这里按实际占位补全。
    const staged = script.filter((command): command is Extract<GameCommand, { type: 'StageCard' }> => command.type === 'StageCard');
    script[script.length - 1] = {
      type: 'Play',
      assignments: staged.map((command) => ({ slotIndex: command.slotIndex, instanceId: command.instanceId })),
    };

    const runOnce = (): { state: GameState; events: BattleEvent[] } => {
      const c = controller();
      const start = c.dispatch({ type: 'NewRun', seed: 'replay-seed' });
      if (!start.ok) throw new Error('新开冒险失败');
      const events: BattleEvent[] = [];
      for (const command of script) {
        const outcome = c.dispatch(command);
        if (!outcome.ok) throw new Error(`命令被拒：${command.type}`);
        events.push(...outcome.value.events);
      }
      return { state: c.state as GameState, events };
    };

    const a = runOnce();
    const b = runOnce();
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
    expect(a.events.length).toBeGreaterThan(0);
  });
});

describe('选择器', () => {
  it('手牌与出牌框视图与直接读状态一致', () => {
    const { c, state } = started();
    const hand = selectHand(state, c.selectors);
    expect(hand.map((card) => card.instanceId)).toEqual([...state.zones.hand]);

    const slots = selectPlaySlots(state, c.selectors);
    expect(slots).toHaveLength(state.zones.playSlots.length);
    expect(slots.every((slot) => slot.card === null)).toBe(true);
    expect(selectEmptySlotIndexes(state)).toEqual(state.zones.playSlots.map((_, index) => index));
  });

  it('资源条与武器候选与状态一致', () => {
    const { c, state } = started();
    const resources = selectResources(state, c.selectors);
    expect(resources.handSize).toBe(state.zones.hand.length);
    expect(resources.gold).toBe(state.run.gold);
    expect(resources.playCountRemaining).toBe(state.battle?.playCountRemaining);
    expect(selectWeaponTargetCandidates(state, c.selectors)).toEqual(c.weaponTargets());
  });

  it('选择器不产生写副作用', () => {
    const { c, state } = started();
    const snapshot = JSON.stringify(state);
    selectHand(state, c.selectors);
    selectPlaySlots(state, c.selectors);
    selectResources(state, c.selectors);
    selectEmptySlotIndexes(state);
    selectWeaponTargetCandidates(state, c.selectors);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('伤害预览调用领域公式，与真实出战结果一致', () => {
    const { c, state } = started();
    const commands = stagingCommands(state).slice(0, 2);
    let working = state;
    for (const command of commands) {
      const outcome = c.dispatch(command);
      if (!outcome.ok) throw new Error('摆牌失败');
      working = outcome.value.state;
    }
    const preview = selectDamagePreview(working, c.selectors);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const assignments = working.zones.playSlots.flatMap((instanceId, slotIndex) =>
      instanceId === null || instanceId === undefined ? [] : [{ slotIndex, instanceId }],
    );
    const played = c.dispatch({ type: 'Play', assignments });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const resolved = played.value.events.find((event) => event.type === 'DamageResolved');
    if (resolved?.type !== 'DamageResolved') throw new Error('没有伤害结算事件');
    expect(preview.value.damage).toBe(resolved.amount);
    expect(preview.value.powerTotal).toBe(resolved.powerTotal);
    expect(preview.value.ampTotal).toBe(resolved.ampTotal);
  });

  it('不在战斗中时无法预估伤害', () => {
    const { state } = started();
    const idle: GameState = { ...state, battle: null };
    const { c } = started();
    expect(selectDamagePreview(idle, c.selectors).ok).toBe(false);
  });
});
