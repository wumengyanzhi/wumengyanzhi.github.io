import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createGameController, type GameController } from '@app/game-controller';
import { createConfigRegistry } from '@config/config-registry';
import type { GameState } from '@domain/state/game-state';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;

afterEach(cleanup);

/**
 * 全流程补全：三选一奖励与结算幕。
 *
 * 出牌走的是控制器命令（不是点击），这样测试只盯住「流程是否走到强化 / 结算」
 * 以及「这两屏是否把该说的话说清楚」，不走一遍二三十次点击。
 */

function stageEverything(controller: GameController): void {
  const state = controller.state;
  if (state === null) return;
  const characters = state.zones.hand.filter((id) => {
    const instance = state.cards[id];
    return instance !== undefined && registry.getCardDefinition(instance.definitionId)?.cardType === 'character';
  });
  const others = state.zones.hand.filter((id) => !characters.includes(id));
  [...characters, ...others].slice(0, 5).forEach((instanceId, slotIndex) => {
    controller.dispatch({ type: 'StageCard', instanceId, slotIndex });
  });
  for (const choice of controller.weaponTargets()) {
    const target = choice.candidateInstanceIds[0];
    if (target !== undefined) {
      controller.dispatch({
        type: 'SelectWeaponTarget',
        weaponInstanceId: choice.weaponInstanceId,
        targetInstanceId: target,
      });
    }
  }
}

function playOnce(controller: GameController): boolean {
  const state = controller.state;
  if (state === null || state.battle === null || state.battle.status !== 'in_progress') return false;
  stageEverything(controller);
  const assignments = controller.state?.zones.playSlots.flatMap((instanceId, slotIndex) =>
    instanceId === null || instanceId === undefined ? [] : [{ slotIndex, instanceId }],
  ) ?? [];
  return assignments.length > 0 && controller.dispatch({ type: 'Play', assignments }).ok;
}

/** 一路打到第一次战后强化为止（或本局结束）。 */
function advanceUntil(controller: GameController, stop: (state: GameState) => boolean): void {
  for (let turn = 0; turn < 40; turn += 1) {
    const state = controller.state;
    if (state === null || state.run.status !== 'running') return;
    if (stop(state)) return;
    if (state.pendingChoice?.kind === 'enhancement_reward') return;
    if (!playOnce(controller)) return;
  }
}

describe('战后强化与结算', () => {
  it('打赢第一场后进入三选一，选中后立刻写进卡牌的永久层', () => {
    const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
    render(<App controller={controller} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: '新开冒险' }));

    act(() => {
      advanceUntil(controller, (state) => state.pendingChoice?.kind === 'enhancement_reward');
    });

    const state = controller.state;
    expect(state?.pendingChoice?.kind).toBe('enhancement_reward');
    if (state?.pendingChoice?.kind !== 'enhancement_reward') return;

    const reward = screen.getByRole('region', { name: '战后强化' });
    const cards = [...reward.querySelectorAll('button.reward-card')];
    expect(cards).toHaveLength(3);

    const candidate = state.pendingChoice.candidates[0]!;
    const before = state.cards[candidate.targetInstanceId];
    const beforePower = before?.permanentPower ?? 0;
    const beforeAmp = before?.permanentAmp ?? 0;

    fireEvent.click(cards[0] as HTMLElement);

    const after = controller.state?.cards[candidate.targetInstanceId];
    if (candidate.attribute === 'power') {
      expect(after?.permanentPower).toBe(beforePower + candidate.amount);
    } else {
      expect(after?.permanentAmp).toBe(beforeAmp + candidate.amount);
    }
    expect(controller.state?.pendingChoice).toBeNull();
  });

  it('三场打完后进入结算，报出已破场次与结果', () => {
    const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
    render(<App controller={controller} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: '新开冒险' }));

    for (let turn = 0; turn < 60; turn += 1) {
      const state = controller.state;
      if (state === null || state.run.status !== 'running') break;
      if (state.pendingChoice?.kind === 'enhancement_reward') {
        const first = state.pendingChoice.candidates[0];
        if (first === undefined) break;
        act(() => {
          controller.dispatch({ type: 'ChooseEnhancement', candidateId: first.id });
        });
        continue;
      }
      act(() => {
        playOnce(controller);
      });
    }

    expect(controller.state?.run.status).not.toBe('running');
    const card = screen.getByRole('region', { name: '本局结算' });
    const won: boolean = controller.state?.run.status === 'won';
    expect(within(card).getByText(won ? '三战告捷' : '败走疆场')).toBeTruthy();
    expect(within(card).getByText(`已破场次`)).toBeTruthy();
    const battlesWon = controller.state?.run.battlesWon ?? 0;
    expect(within(card).getByText(`${battlesWon} / 3`)).toBeTruthy();
  });
});
