import type { ReactElement } from 'react';
import type { RunState } from '@domain/state/run-state';

/**
 * 通关 / 失败结算。
 *
 * 只报结果和几个能印证过程的数字：打了几场、还剩多少资源。
 * 失败时直说卡在哪一场，玩家马上知道该重试还是换打法。
 */

export interface ResultScreenProps {
  readonly run: RunState;
  readonly totalBattles: number;
  readonly stalledEnemyName: string | null;
  readonly onRestart: () => void;
  readonly onBackToMenu: () => void;
  readonly onExport: () => void;
}

export function ResultScreen({
  run,
  totalBattles,
  stalledEnemyName,
  onRestart,
  onBackToMenu,
  onExport,
}: ResultScreenProps): ReactElement {
  const won = run.status === 'won';

  return (
    <section className="result-screen" aria-label="本局结算">
      <div className="result-card">
        <h2 className={`result-title ${won ? 'result-title--won' : 'result-title--lost'}`}>
          {won ? '三战告捷' : '败走疆场'}
        </h2>
        <p className="result-sub">
          {won
            ? '虎牢魔将已破，这一局到此为止。'
            : `第 ${run.battlesWon + 1} 战止步于 ${stalledEnemyName ?? '敌军'}。`}
        </p>

        <div className="result-stats">
          <div className="result-stat">
            <span className="result-stat__label">已破场次</span>
            <span className="result-stat__value num">{run.battlesWon} / {totalBattles}</span>
          </div>
          <div className="result-stat">
            <span className="result-stat__label">剩余金币</span>
            <span className="result-stat__value num">{run.gold}</span>
          </div>
          <div className="result-stat">
            <span className="result-stat__label">强化次数</span>
            <span className="result-stat__value num">{Math.min(run.battlesWon, totalBattles - 1)}</span>
          </div>
        </div>

        <div className="result-actions">
          <button type="button" className="btn btn--primary" onClick={onRestart}>
            再开一局
          </button>
          <button type="button" className="btn btn--ghost" onClick={onExport}>
            导出存档
          </button>
          <button type="button" className="btn btn--ghost" onClick={onBackToMenu}>
            返回主菜单
          </button>
        </div>
      </div>
    </section>
  );
}
