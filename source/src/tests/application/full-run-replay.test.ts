import { describe, expect, it } from 'vitest';
import { createGameController, type GameCommand } from '@app/game-controller';
import { createConfigRegistry } from '@config/config-registry';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';
import type { BattleEvent } from '@domain/events/battle-events';
import type { InstanceId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';

/**
 * 整局确定性重放。
 *
 * 阶段 11 的跨阶段必测项：同一个种子跑完整局，两次运行的状态与事件序列必须逐字节一致。
 * 这条比单次出战的重放严格得多——它跨三场战斗、两次强化，任何一处偷偷用了 Math.random、
 * 或者把顺序依赖藏进了对象遍历，都会在这里暴露。
 *
 * 顺带守住「整局可通关」：这套走法固定，所以通关与否是确定的，不是碰运气。
 */

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;

interface RunOutcome {
  readonly final: GameState;
  readonly events: readonly BattleEvent[];
  readonly steps: number;
  readonly handOnStart: readonly InstanceId[];
  /** 走这条线一共做过几次战后强化选择。 */
  readonly rewardsChosen: number;
}

interface Hand {
  readonly characters: readonly InstanceId[];
  readonly weapons: readonly InstanceId[];
  readonly tactics: readonly InstanceId[];
}

function splitHand(state: GameState): Hand {
  const characters: InstanceId[] = [];
  const weapons: InstanceId[] = [];
  const tactics: InstanceId[] = [];
  for (const instanceId of state.zones.hand) {
    const instance = state.cards[instanceId];
    const definition = instance === undefined ? undefined : registry.getCardDefinition(instance.definitionId);
    if (definition === undefined) continue;
    if (definition.cardType === 'character') characters.push(instanceId);
    else if (definition.cardType === 'weapon') weapons.push(instanceId);
    else if (definition.cardType === 'tactic') tactics.push(instanceId);
  }
  return { characters, weapons, tactics };
}

function relationAmp(weaponId: InstanceId, targetId: InstanceId, state: GameState): number {
  const weapon = weaponId === '' ? undefined : state.cards[weaponId];
  const target = targetId === '' ? undefined : state.cards[targetId];
  const weaponDefinition = weapon === undefined ? undefined : registry.getCardDefinition(weapon.definitionId);
  const targetDefinition = target === undefined ? undefined : registry.getCardDefinition(target.definitionId);
  if (weaponDefinition?.cardType !== 'weapon' || targetDefinition?.cardType !== 'character') return 0;
  const relation = registry.config.matchMatrix.matrix[targetDefinition.profession]?.[weaponDefinition.weaponClass];
  return relation === undefined ? 0 : (registry.config.matchMatrix.relationAmp[relation] ?? 0);
}

function basePowerOf(instanceId: InstanceId, state: GameState): number {
  const instance = state.cards[instanceId];
  const definition = instance === undefined ? undefined : registry.getCardDefinition(instance.definitionId);
  return definition?.basePower ?? 0;
}

/**
 * 固定的「武—人—人—武—术」走法：两件兵器各夹住一个人物，两个匹配区一起计入增幅。
 *
 * 为什么不是「三个人物加一件兵器」：那样只有一桩匹配，实测一整局下来首领差 270 点打不动。
 * 这套走法的选牌规则只有两条，都很确定——先在职业 × 兵器表里挑增幅总和最高的两对，
 * 同分再比威力，因此同一手牌永远给出同一个方案，没有第二个随机源。
 */
function planFor(state: GameState): readonly { readonly slotIndex: number; readonly instanceId: InstanceId }[] {
  const { characters, weapons, tactics } = splitHand(state);
  if (characters.length === 0 || weapons.length === 0) {
    // 手上没有可组阵的牌：能出什么出什么，保证整局不会卡死在这里。
    const fallback = [...characters, ...weapons, ...tactics].slice(0, 5);
    return fallback.map((instanceId, slotIndex) => ({ slotIndex, instanceId }));
  }

  let best: { score: number; power: number; plan: readonly { slotIndex: number; instanceId: InstanceId }[] } | null = null;
  const weaponSlots = [[0, 3], [0, 2], [1, 3]] as const;

  for (const [leftSlot, rightSlot] of weaponSlots) {
    for (const leftWeapon of weapons) {
      for (const rightWeapon of weapons) {
        if (leftWeapon === rightWeapon) continue;
        for (const leftTarget of characters) {
          for (const rightTarget of characters) {
            if (leftTarget === rightTarget) continue;
            const amp = relationAmp(leftWeapon, leftTarget, state) + relationAmp(rightWeapon, rightTarget, state);
            if (amp === 0) continue;
            const power =
              basePowerOf(leftWeapon, state)
              + basePowerOf(rightWeapon, state)
              + basePowerOf(leftTarget, state)
              + basePowerOf(rightTarget, state);
            const plan = [
              { slotIndex: leftSlot, instanceId: leftWeapon },
              { slotIndex: leftSlot + 1, instanceId: leftTarget },
              { slotIndex: rightSlot, instanceId: rightWeapon },
              { slotIndex: rightSlot + 1, instanceId: rightTarget },
            ];
            if (best === null || amp > best.score || (amp === best.score && power > best.power)) {
              best = { score: amp, power, plan };
            }
          }
        }
      }
    }
  }

  const chosen = best;
  if (chosen === null) {
    const fallback = [...characters, ...weapons, ...tactics].slice(0, 5);
    return fallback.map((instanceId, slotIndex) => ({ slotIndex, instanceId }));
  }

  const used = new Set(chosen.plan.map((entry) => entry.instanceId));
  const tactic = tactics.find((instanceId) => !used.has(instanceId));
  const occupied = new Set(chosen.plan.map((entry) => entry.slotIndex));
  const freeSlot = [0, 1, 2, 3, 4].find((slotIndex) => !occupied.has(slotIndex));
  return tactic === undefined || freeSlot === undefined
    ? chosen.plan
    : [...chosen.plan, { slotIndex: freeSlot, instanceId: tactic }];
}

function driveFullRun(seed: string): RunOutcome {
  const controller = createGameController({
    registry,
    storage: createMemoryStorage(),
    rng: createSeededRng(),
  });
  const events: BattleEvent[] = [];
  const dispatch = (command: GameCommand): void => {
    const outcome = controller.dispatch(command);
    if (!outcome.ok) {
      throw new Error(`第 ${events.length} 个事件处命令被拒：${command.type} —— ${outcome.error.message}`);
    }
    events.push(...outcome.value.events);
  };

  dispatch({ type: 'NewRun', seed });
  const handOnStart = controller.state?.zones.hand ?? [];

  let steps = 0;
  let rewardsChosen = 0;
  while (steps < 120) {
    steps += 1;
    const state = controller.state;
    if (state === null) throw new Error('状态丢失');
    if (state.run.status !== 'running') break;

    const reward = state.pendingChoice?.kind === 'enhancement_reward' ? state.pendingChoice : null;
    if (reward !== null) {
      const candidate = reward.candidates[0];
      if (candidate === undefined) throw new Error('强化奖励没有候选');
      dispatch({ type: 'ChooseEnhancement', candidateId: candidate.id });
      rewardsChosen += 1;
      continue;
    }

    const battle = state.battle;
    if (battle === null || battle.status !== 'in_progress') break;
    const plan = planFor(state);
    if (plan.length === 0) throw new Error('手牌里没有任何可出的牌');

    for (const entry of plan) {
      dispatch({ type: 'StageCard', instanceId: entry.instanceId, slotIndex: entry.slotIndex });
    }
    dispatch({ type: 'Play', assignments: plan });
  }

  const final = controller.state;
  if (final === null) throw new Error('整局跑完后状态为空');
  return { final, events, steps, handOnStart, rewardsChosen };
}

const SEED = 'mvp-full-run';

describe('整局确定性重放', () => {
  it('同一个种子跑完整局，状态与事件序列逐字节一致', () => {
    const first = driveFullRun(SEED);
    const second = driveFullRun(SEED);

    expect(second.steps).toBe(first.steps);
    expect(second.events).toEqual(first.events);
    expect(second.final).toEqual(first.final);
    expect(first.events.length).toBeGreaterThan(10);
  });

  it('同一套走法能把三场打完并通关，过程还覆盖两次战后强化', () => {
    const outcome = driveFullRun(SEED);

    expect(outcome.final.run.status).toBe('won');
    expect(outcome.final.run.battlesWon).toBe(3);

    // 三场战斗各最多四手，每手一条伤害结算；打不满说明提前把敌人打死了，也是正常的。
    const resolved = outcome.events.filter((event) => event.type === 'DamageResolved');
    expect(resolved.length).toBeGreaterThanOrEqual(3);
    expect(resolved.length).toBeLessThanOrEqual(12);

    // 两场胜利各给一次强化：这条走法必须真的走到强化，否则「三场闭环」没被覆盖。
    // 强化本身不产生战斗事件，所以数的是走这条线时实际做过的选择次数。
    expect(outcome.rewardsChosen).toBe(2);

    const wins = outcome.events.filter((event) => event.type === 'BattleWon');
    const losses = outcome.events.filter((event) => event.type === 'BattleLost');
    expect(wins.length).toBe(3);
    expect(losses.length).toBe(0);
  });

  it('换一个种子起手不同，说明随机确实经过 RngPort 而不是写死的顺序', () => {
    const a = driveFullRun('seed-a');
    const b = driveFullRun('seed-b');
    expect([...a.handOnStart].sort()).not.toEqual([...b.handOnStart].sort());
  });

  it('整局过程中没有任何一次命令被拒（失败会直接抛出）', () => {
    const outcome = driveFullRun(SEED);
    expect(outcome.steps).toBeGreaterThan(0);
    expect(outcome.steps).toBeLessThan(120);
  });
});
