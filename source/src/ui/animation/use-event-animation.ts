import { useCallback, useEffect, useRef, useState } from 'react';
import type { BattleEvent } from '@domain/events/battle-events';
import {
  runAnimationSequence,
  type AnimationRun,
  type AnimationStep,
  type OrchestratorReport,
} from './animation-orchestrator';

/**
 * 把领域事件接到界面动画。
 *
 * 事件来自 controller 的事件队列，播完就丢，不回写任何东西。
 * 这个 hook 只维护两类状态：正在演第几段（给跳过按钮用），以及当前生效的光效标记（给 CSS 用）。
 * 关键区别：领域状态早在 dispatch 的一瞬间就定了，动画播到哪都不改它。
 */

export interface EventAnimationApi {
  readonly playing: boolean;
  /** 当前段的名字，跳过按钮旁边显示。 */
  readonly label: string | null;
  /** 挂到外壳 data-anim 上的标记集合，CSS 直接按这些名字开灯。 */
  readonly marks: readonly string[];
  readonly lastReport: OrchestratorReport | null;
  play(events: readonly BattleEvent[]): void;
  skip(): void;
}

export interface EventAnimationOptions {
  readonly enabled: boolean;
  /** 某段动画出错时的上报口子；默认静默——出错不影响状态，没必要打断玩家。 */
  readonly onStepFailed?: (step: AnimationStep, message: string) => void;
}

export function useEventAnimation({ enabled, onStepFailed }: EventAnimationOptions): EventAnimationApi {
  const [marks, setMarks] = useState<readonly string[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<OrchestratorReport | null>(null);

  const runRef = useRef<AnimationRun | null>(null);
  const pendingRef = useRef<readonly BattleEvent[]>([]);
  const busyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runRef.current?.skip();
    };
  }, []);

  const startBatch = useCallback((events: readonly BattleEvent[]) => {
    busyRef.current = true;
    const run = runAnimationSequence(events, {
      enabled,
      callbacks: {
        onStart: (step) => {
          if (!mounted.current) return;
          setLabel(step.label);
          setMarks((active) => (active.includes(step.mark) ? active : [...active, step.mark]));
        },
        onSettle: (step) => {
          if (!mounted.current) return;
          setMarks((active) => active.filter((mark) => mark !== step.mark));
        },
      },
    });
    runRef.current = run;
    void run.done.then((report) => {
      runRef.current = null;
      busyRef.current = false;
      if (!mounted.current) return;
      setLabel(null);
      setLastReport(report);
      for (const entry of report.skipped) {
        if (entry.reason === 'failed') onStepFailed?.(entry.step, entry.message);
      }
      const queued = pendingRef.current;
      pendingRef.current = [];
      if (queued.length > 0 && mounted.current) startBatch(queued);
    });
  }, [enabled, onStepFailed]);

  const play = useCallback((events: readonly BattleEvent[]): void => {
    // 关掉动画时一步都不演：不排队、不置忙、不挂光效，界面直接停在命令给出的终态上。
    if (events.length === 0 || !enabled) return;
    if (busyRef.current) {
      pendingRef.current = [...pendingRef.current, ...events];
      return;
    }
    startBatch(events);
  }, [startBatch]);

  const skip = useCallback((): void => {
    runRef.current?.skip();
    pendingRef.current = [];
  }, []);

  return { playing: busyRef.current || marks.length > 0, label, marks, lastReport, play, skip };
}
