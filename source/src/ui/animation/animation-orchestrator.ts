import type { BattleEvent } from '@domain/events/battle-events';
import { presetFor, type AnimationName } from './presets';

/**
 * 动画编排器。
 *
 * 把一串领域事件翻译成一段有序动画：开演 → 播够时长 → 落终态 → 下一环。
 * 三条硬规矩：
 *
 * 1. 编排器只读事件、只调 UI 回调，从不碰 GameState —— 状态早在 dispatch 里就提交完了。
 * 2. 关掉动画时不播前文直接落终态，`settled` 仍覆盖每一步，界面不会出现停在半路的数值。
 * 3. 某一段动画自己炸了（回调抛错、DOM 没了），只跳过这一段，后面的照常播完，更不回滚状态。
 *
 * 时间与调度全部注入，所以整套东西可以在没有真实定时器的环境里单测。
 */

export interface AnimationStep {
  readonly index: number;
  readonly name: AnimationName;
  readonly mark: string;
  readonly label: string;
  readonly duration: number;
  readonly event: BattleEvent;
}

export type StepCallbacks = {
  /** 动画开场。抛错＝这一段放弃演出。 */
  readonly onStart?: (step: AnimationStep) => void;
  /** 落终态。无论开关、跳过、出错都必须走到，这里是界面最终的呈现依据。 */
  readonly onSettle?: (step: AnimationStep) => void;
};

export type SkipReason = 'disabled' | 'skip' | 'failed';

export interface SkippedStep {
  readonly step: AnimationStep;
  readonly reason: SkipReason;
  readonly message: string;
}

export interface OrchestratorReport {
  readonly total: number;
  /** 真的播了动画的段数；关动画时为 0。 */
  readonly played: number;
  /** 落到终态的段数；任何情况下都等于 total。 */
  readonly settled: number;
  readonly skipped: readonly SkippedStep[];
}

export type ScheduleHandle = ReturnType<typeof setTimeout>;

export interface OrchestratorOptions {
  readonly enabled: boolean;
  readonly callbacks: StepCallbacks;
  readonly schedule?: (task: () => void, delay: number) => ScheduleHandle;
  readonly cancelScheduled?: (handle: ScheduleHandle) => void;
}

export interface AnimationRun {
  readonly steps: readonly AnimationStep[];
  readonly done: Promise<OrchestratorReport>;
  /** 立刻跳到终态，剩下的段不再演。 */
  skip(): void;
}

export function buildSteps(events: readonly BattleEvent[]): readonly AnimationStep[] {
  return events.map((event, index) => {
    const preset = presetFor(event);
    return { index, name: preset.name, mark: preset.mark, label: preset.label, duration: preset.duration, event };
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function runAnimationSequence(
  events: readonly BattleEvent[],
  options: OrchestratorOptions,
): AnimationRun {
  const steps = buildSteps(events);
  const scheduleFn = options.schedule ?? ((task, delay) => setTimeout(task, delay));
  const cancelFn = options.cancelScheduled ?? ((handle) => clearTimeout(handle));

  let cursor = 0;
  let played = 0;
  let settled = 0;
  let handle: ScheduleHandle | null = null;
  /** 正在播的那一段的下标：cursor 已经走到它后面，落到终态时要单独点名。 */
  let inFlight = -1;
  let finished = false;
  const skipped: SkippedStep[] = [];
  let resolveRun: (report: OrchestratorReport) => void = () => undefined;
  const done = new Promise<OrchestratorReport>((resolve) => {
    resolveRun = resolve;
  });

  function settleAt(index: number): void {
    const step = steps[index];
    if (step === undefined) return;
    try {
      options.callbacks.onSettle?.(step);
    } catch (error) {
      skipped.push({ step, reason: 'failed', message: describe(error) });
    }
    settled += 1;
  }

  function startAt(index: number): void {
    const step = steps[index];
    if (step === undefined) return;
    try {
      options.callbacks.onStart?.(step);
      played += 1;
    } catch (error) {
      // 演出炸了不影响别的段，也不回滚任何东西：只是这一段没演。
      skipped.push({ step, reason: 'failed', message: describe(error) });
    }
  }

  function close(): void {
    if (finished) return;
    finished = true;
    if (handle !== null) {
      cancelFn(handle);
      handle = null;
    }
    resolveRun({ total: steps.length, played, settled, skipped: skipped.slice() });
  }

  function pump(): void {
    while (cursor < steps.length && !finished) {
      const index = cursor;
      const step = steps[index];
      if (step === undefined) break;
      cursor += 1;
      if (!options.enabled) {
        skipped.push({ step, reason: 'disabled', message: '动画已关闭，直接落到终态' });
        settleAt(index);
        continue;
      }
      startAt(index);
      inFlight = index;
      handle = scheduleFn(() => {
        handle = null;
        inFlight = -1;
        settleAt(index);
        pump();
      }, step.duration);
      return;
    }
    close();
  }

  function skip(): void {
    if (finished) return;
    // 正在播的这一段要补一次终态（cursor 已经越过它了），后面的整段跳过演出直接结算。
    if (inFlight >= 0) {
      const index = inFlight;
      inFlight = -1;
      if (handle !== null) {
        cancelFn(handle);
        handle = null;
      }
      settleAt(index);
    }
    while (cursor < steps.length) {
      const index = cursor;
      const step = steps[index];
      if (step === undefined) break;
      cursor += 1;
      settleAt(index);
    }
    close();
  }

  pump();

  return { steps, done, skip };
}
