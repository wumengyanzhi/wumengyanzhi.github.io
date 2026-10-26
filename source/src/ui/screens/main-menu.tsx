import type { ReactElement } from 'react';
import type { Notice } from '../state/ui-store';

/**
 * 主菜单。
 *
 * 唯一的一级标题在这里：标题本体就是游戏名，副标题一句话讲清单局结构。
 * 「继续游戏」只在确实有存档时可用——不给玩家一个点下去必然报错的按钮。
 */

export interface MainMenuProps {
  readonly canResume: boolean;
  readonly canReturn: boolean;
  readonly animationsEnabled: boolean;
  readonly notice: Notice | null;
  readonly onStart: () => void;
  readonly onResume: () => void;
  readonly onReturn: () => void;
  readonly onExport: () => void;
  readonly onImport: (file: File | undefined) => void;
  readonly onToggleAnimations: (enabled: boolean) => void;
}

export function MainMenu({
  canResume,
  canReturn,
  animationsEnabled,
  notice,
  onStart,
  onResume,
  onReturn,
  onExport,
  onImport,
  onToggleAnimations,
}: MainMenuProps): ReactElement {
  return (
    <section className="menu-screen" aria-label="主菜单">
      <div className="menu-card">
        <h1 className="menu-title">神话三国 · 网页 MVP</h1>
        <p className="menu-sub">三场定胜负 · 人物配兵器 · 每一次出牌都是一次结算</p>

        <div className="menu-rule" aria-hidden="true">◆</div>

        <div className="menu-actions">
          <button type="button" className="btn btn--primary btn--large" onClick={onStart}>
            新开冒险
          </button>
          <button type="button" className="btn btn--large" disabled={!canResume} onClick={onResume}>
            继续游戏
          </button>
          {canReturn && (
            <button type="button" className="btn btn--ghost" onClick={onReturn}>
              返回当前战局
            </button>
          )}
        </div>

        <div className="menu-note">
          <label className="menu-toggle">
            <input
              type="checkbox"
              checked={animationsEnabled}
              onChange={(event) => onToggleAnimations(event.target.checked)}
            />
            启用动画与飘字
          </label>
          <div className="menu-files">
            <button type="button" className="btn btn--ghost" disabled={!canReturn} onClick={onExport}>
              导出存档
            </button>
            <label className="file-field">
              导入存档
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  onImport(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        {notice !== null && (
          <p className={notice.kind === 'error' ? 'notice notice--error' : 'notice'} role="status">
            {notice.text}
          </p>
        )}

        <p className="menu-run">
          本局为 <strong>固定三场</strong>：黄巾军阵 · 西凉铁骑 · 虎牢魔将。敌人不会出手，胜负取决于你在有限出战次数内打出多少伤害。
        </p>
      </div>
    </section>
  );
}
