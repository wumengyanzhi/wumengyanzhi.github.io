import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAnimationSequence, type AnimationStep, type SkippedStep } from '@ui/animation/animation-orchestrator';
import { allPresetNames } from '@ui/animation/presets';
import { App } from '../../App';
import { createGameController } from '@app/game-controller';
import { createConfigRegistry } from '@config/config-registry';
import type { BattleEvent } from '@domain/events/battle-events';
import type { DefinitionId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;

const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/motion.css'), 'utf8');

afterEach(cleanup);

/**
 * 阶段九的三条不变量：
 *
 * 1. 动画是一次有顺序的演出，时长只影响观感。
 * 2. 开动画与关动画走到同一个 GameState、同一串事件 —— 动画从不参与规则。
 * 3. 某一段动画自己炸了，只炸这一段：后续照播，状态早已提交且绝不回滚。
 */

const EVENTS: readonly BattleEvent[] = [
  { type: 'CardsDrawn', instanceIds: [] },
  { type: 'CardsPlayed', instanceIds: [], slotIndexes: [0, 1] },
  { type: 'DamageResolved', amount: 120, powerTotal: 60, ampTotal: 2, enemyHpAfter: 900 },
  { type: 'BattleWon', enemyDefinitionId: 'huangjin' as DefinitionId },
];

describe('动画序列', () => {
  it('按预设时长一段一段播，播完每一段都落到终态', () => {
    vi.useFakeTimers();
    try {
      const marks: string[] = [];
      const run = runAnimationSequence(EVENTS, {
        enabled: true,
        callbacks: {
          onStart: (step) => marks.push(`start:${step.name}`),
          onSettle: (step) => marks.push(`settle:${step.name}`),
        },
      });

      expect(marks).toEqual(['start:cards-drawn']);
      vi.advanceTimersByTime(200);
      expect(marks).toEqual(['start:cards-drawn', 'settle:cards-drawn', 'start:cards-played']);

      vi.advanceTimersByTime(260 + 420 + 320);
      return run.done.then((report) => {
        expect(report.total).toBe(4);
        expect(report.played).toBe(4);
        expect(report.settled).toBe(4);
        expect(report.skipped).toHaveLength(0);
        expect(marks.filter((mark) => mark.startsWith('settle:'))).toHaveLength(4);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('关掉动画时不排任何定时器，直接全额落到终态', () => {
    // 这个假定时器一旦被调用就立刻执行：如果编排器在关闭动画时还排迟缓回调，测试会当场炸掉。
    const schedule = vi.fn((task: () => void) => {
      task();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    let settled = 0;
    const run = runAnimationSequence(EVENTS, {
      enabled: false,
      callbacks: { onSettle: () => { settled += 1; } },
      schedule,
    });

    expect(settled).toBe(4);
    expect(schedule).not.toHaveBeenCalled();
    return run.done.then((report) => {
      expect(report.played).toBe(0);
      expect(report.settled).toBe(4);
      expect(report.skipped.every((entry) => entry.reason === 'disabled')).toBe(true);
    });
  });

  it('某段动画抛错只跳过那一段，后面的照常播', () => {
    vi.useFakeTimers();
    try {
      const played: string[] = [];
      let settled = 0;
      const run = runAnimationSequence(EVENTS, {
        enabled: true,
        callbacks: {
          onStart: (step) => {
            if (step.name === 'cards-played') throw new Error('演示用失败');
            played.push(step.name);
          },
          onSettle: () => { settled += 1; },
        },
      });

      vi.advanceTimersByTime(200 + 260 + 420 + 320);
      return run.done.then((report) => {
        const failures: SkippedStep[] = [...report.skipped].filter((entry) => entry.reason === 'failed');
        expect(failures).toHaveLength(1);
        expect(failures[0]?.step.name).toBe('cards-played');
        expect(played).toEqual(['cards-drawn', 'damage-tick', 'battle-won']);
        expect(settled).toBe(4);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('跳过时正在播的段落立刻结算，剩下的不再等待', () => {
    vi.useFakeTimers();
    try {
      let settled = 0;
      const run = runAnimationSequence(EVENTS, {
        enabled: true,
        callbacks: { onSettle: () => { settled += 1; } },
      });
      vi.advanceTimersByTime(200);
      expect(settled).toBe(1);

      run.skip();
      expect(settled).toBe(4);
      return run.done.then((report) => {
        expect(report.settled).toBe(report.total);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

/** 把一局打到不能再打为止：两份跑法必须完全一致。 */
function runWholeGame(playing: boolean): { readonly state: GameState; readonly events: readonly BattleEvent[] } {
  const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
  const events: BattleEvent[] = [];
  controller.dispatch({ type: 'NewRun', seed: 'phase-9-parity' });

  for (let turn = 0; turn < 60; turn += 1) {
    const state = controller.state;
    if (state === null || state.run.status !== 'running') break;
    if (state.pendingChoice?.kind === 'enhancement_reward') {
      const outcome = controller.dispatch({
        type: 'ChooseEnhancement',
        candidateId: state.pendingChoice.candidates[0]!.id,
      });
      if (outcome.ok) events.push(...outcome.value.events);
      continue;
    }
    const battle = state.battle;
    if (battle === null || battle.status !== 'in_progress') break;

    state.zones.hand.forEach((instanceId, slotIndex) => {
      if (slotIndex >= 5) return;
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
    const assignments = (controller.state?.zones.playSlots ?? []).flatMap((instanceId, slotIndex) =>
      instanceId === null || instanceId === undefined ? [] : [{ slotIndex, instanceId }],
    );
    const outcome = controller.dispatch({ type: 'Play', assignments });
    if (!outcome.ok) break;
    events.push(...outcome.value.events);
    if (playing) {
      runAnimationSequence(outcome.value.events, { enabled: true, callbacks: {} });
    }
  }

  const finalState = controller.state;
  if (finalState === null) throw new Error('本局未创建');
  return { state: finalState, events };
}

describe('动画不影响规则', () => {
  it('同种子同命令，开动画与关动画两条路的力量结果完全一致', () => {
    const withAnimation = runWholeGame(true);
    const withoutAnimation = runWholeGame(false);

    expect(JSON.stringify(withAnimation.state)).toBe(JSON.stringify(withoutAnimation.state));
    expect(withAnimation.events.map((event) => event.type)).toEqual(
      withoutAnimation.events.map((event) => event.type),
    );
    expect(JSON.stringify(withAnimation.events)).toBe(JSON.stringify(withoutAnimation.events));
  });

  it('动画回调抛错时，这一手的状态早已提交且不回滚', () => {
    const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
    controller.dispatch({ type: 'NewRun', seed: 'phase-9-failure' });
    const hand = controller.state?.zones.hand ?? [];
    const staged = hand.slice(0, 3);
    staged.forEach((instanceId, slotIndex) => {
      controller.dispatch({ type: 'StageCard', instanceId, slotIndex });
    });
    // 兵器夹在两张人物之间时必须先指定归属，否则 Play 会被领域拒绝，测不到动画那一层。
    for (const choice of controller.weaponTargets()) {
      const target = choice.candidateInstanceIds[0];
      if (target === undefined) continue;
      controller.dispatch({
        type: 'SelectWeaponTarget',
        weaponInstanceId: choice.weaponInstanceId,
        targetInstanceId: target,
      });
    }
    const assignments = (controller.state?.zones.playSlots ?? []).flatMap((instanceId, slotIndex) =>
      instanceId === null || instanceId === undefined ? [] : [{ slotIndex, instanceId }],
    );

    const before = controller.state?.battle?.enemyCurrentHp ?? 0;
    const outcome = controller.dispatch({ type: 'Play', assignments });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // 状态在命令返回前就已经定型：这里只是把 UI 回调喂一个必炸的实现。
    const committed: GameState = outcome.value.state;
    const broken: AnimationStep['event'][] = [];
    const run = runAnimationSequence(outcome.value.events, {
      enabled: true,
      callbacks: {
        onStart: () => { throw new Error('UI 回调炸了'); },
        onSettle: (step) => broken.push(step.event),
      },
    });

    expect(controller.state).toBe(committed);
    expect(controller.state?.battle?.enemyCurrentHp ?? before).toBeLessThan(before);
    expect(controller.state?.battle?.completedPlays).toBe(1);
    return run.done.then((report) => {
      expect(report.skipped.length).toBeGreaterThan(0);
      expect(broken).toHaveLength(outcome.value.events.length);
    });
  });
  it('每个动画标记都在样式里有对应的演出，不会出现播了但屏幕没反应', () => {
    const missing = allPresetNames().filter((name) => !css.includes(`[data-anim~="${name}"]`));
    expect(missing).toEqual([]);
  });
});

/** 走一整套弃牌操作：命令由界面自己发，事件才会真的流到动画层。 */
function discardFirstCard(): void {
  fireEvent.click(screen.getAllByRole('button', { name: /^标记弃牌：/ })[0]!);
  fireEvent.click(screen.getByRole('button', { name: '弃掉所选并补牌' }));
}

function shellAnim(): string | null {
  const shell = document.querySelector('main.app-shell');
  if (shell === null) throw new Error('外壳缺失');
  return shell.getAttribute('data-anim');
}

describe('动画开关在界面上生效', () => {
  it('开着动画时外壳挂出正在播的段，并提供跳过按钮', async () => {
    const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
    render(<App controller={controller} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: '新开冒险' }));

    discardFirstCard();

    expect(shellAnim()).toContain('cards-discarded');
    expect(screen.getByRole('button', { name: '跳过动画' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '跳过动画' }));
    expect(shellAnim()).toBeNull();

    // 序列承诺在这里收尾，避免 animations 的终态回调落到测试之外。
    await act(async () => { await Promise.resolve(); });
  });

  it('关掉动画后直接到终态，外壳不挂任何段，也不给跳过按钮', () => {
    const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
    render(<App controller={controller} registry={registry} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /启用动画/ }));
    fireEvent.click(screen.getByRole('button', { name: '新开冒险' }));

    discardFirstCard();

    expect(shellAnim()).toBeNull();
    expect(screen.queryByRole('button', { name: '跳过动画' })).toBeNull();
  });
});
