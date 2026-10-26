import type { ReactElement } from 'react';
import type { DamagePreview } from '@app/selectors';
import type { AppError } from '@shared/error-codes';
import type { Result } from '@shared/result';

/**
 * 伤害预览与出战按钮。
 *
 * 数字全部取自领域的 DamagePreview —— 领域算好，界面只负责把它放到玩家眼前。
 * 任何错误原因也由领域给出，界面不做二次判断。
 */

export interface DamagePreviewPanelProps {
  readonly preview: Result<DamagePreview, AppError> | null;
  readonly staged: boolean;
  readonly pendingTargets: number;
  readonly canAct: boolean;
  readonly onPlay: () => void;
  readonly onPickTargets: () => void;
}

export function DamagePreviewPanel({
  preview,
  staged,
  pendingTargets,
  canAct,
  onPlay,
  onPickTargets,
}: DamagePreviewPanelProps): ReactElement {
  const rows = preview?.ok === true
    ? (
      <>
        <div className="preview__row">
          <dt>威力总值</dt>
          <dd className="num">{preview.value.powerTotal.toLocaleString('zh-CN')}</dd>
        </div>
        <div className="preview__row">
          <dt>增幅总值</dt>
          <dd className="num">{preview.value.ampTotal.toLocaleString('zh-CN')}</dd>
        </div>
        <div className="preview__rule" />
        <div className="preview__row preview__row--hp">
          <dt>结算后敌血</dt>
          <dd className="num">{Math.max(0, preview.value.enemyHpAfter).toLocaleString('zh-CN')}</dd>
        </div>
      </>
    )
    : null;

  return (
    <aside className="preview" aria-label="伤害预览">
      <h3 className="panel-title">伤害预览</h3>

      {rows !== null && preview?.ok === true && (
        <>
          <dl className="preview__rows">{rows}</dl>
          <div className="preview__total">
            <span className="preview__total-label">预计伤害</span>
            <span className="preview__total-value">{preview.value.damage.toLocaleString('zh-CN')}</span>
          </div>
        </>
      )}

      {preview?.ok === false && <p className="preview__error">{preview.error.message}</p>}

      {preview === null && (
        <p className="preview__empty">
          {staged ? '出牌框里还没有完整组合。' : '从下方手牌选一张，再点出牌框的空位放上去。'}
        </p>
      )}

      {pendingTargets > 0 ? (
        <button type="button" className="btn btn--primary" onClick={onPickTargets}>
          指定兵器归属（{pendingTargets}）
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canAct || preview?.ok !== true}
          onClick={onPlay}
        >
          出战结算
        </button>
      )}
    </aside>
  );
}
