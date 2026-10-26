import { useEffect, useState, type ReactElement } from 'react';
import type { EnemyType } from '@domain/models/enums';

/**
 * 敌人面板。
 *
 * 血条上直接画出「本次结算会打掉多少」的虚段落差，玩家不用心算。
 * 预测值来自领域的 DamagePreview，界面不做减法之外的任何推导。
 * 真正的伤害数字从 0 跳到结果——那段跳动只是观感，跳到一半和跳到底指向同一个 GameState。
 */

const ENEMY_TYPE_TEXT: Readonly<Record<EnemyType, string>> = {
  normal: '普通',
  elite: '精英',
  boss: '首领',
};

const TICK_MS = 380;
const TICK_STEPS = 8;

/** 数字跳动：关掉动画时直接等于终值，绝不出现停在中间看的数字。 */
function useCountUp(value: number | null, token: number, enabled: boolean): number | null {
  const [shown, setShown] = useState<number | null>(value);

  useEffect(() => {
    if (value === null || value <= 0) {
      setShown(value);
      return undefined;
    }
    if (!enabled) {
      setShown(value);
      return undefined;
    }
    let step = 0;
    setShown(0);
    const timer = setInterval(() => {
      step += 1;
      const progress = Math.min(1, step / TICK_STEPS);
      setShown(Math.round(value * progress));
      if (step >= TICK_STEPS) clearInterval(timer);
    }, TICK_MS / TICK_STEPS);
    return () => clearInterval(timer);
  }, [value, token, enabled]);

  return shown;
}

export interface EnemyPanelProps {
  readonly name: string;
  readonly type: EnemyType;
  readonly currentHp: number;
  readonly maxHp: number;
  readonly previewAfterHp: number | null;
  readonly lastDamage: number | null;
  readonly lastDamageToken: number;
  readonly animationsEnabled: boolean;
}

export function EnemyPanel({
  name,
  type,
  currentHp,
  maxHp,
  previewAfterHp,
  lastDamage,
  lastDamageToken,
  animationsEnabled,
}: EnemyPanelProps): ReactElement {
  const shownDamage = useCountUp(lastDamage, lastDamageToken, animationsEnabled);
  const safeMax = maxHp > 0 ? maxHp : 1;
  const currentPercent = Math.max(0, Math.min(100, (Math.max(0, currentHp) / safeMax) * 100));
  const afterPercent = previewAfterHp === null
    ? currentPercent
    : Math.max(0, Math.min(100, (Math.max(0, previewAfterHp) / safeMax) * 100));
  const ghostPercent = Math.max(0, currentPercent - afterPercent);
  const lethal = previewAfterHp !== null && previewAfterHp <= 0;

  return (
    <section className="topbar__panel panel enemy-panel" aria-label="敌人面板">
      {/* 名号、类型、血量挤在同一行：顶栏只有两行的高度预算，多出来的那一行会去挤手牌。 */}
      <div className="enemy-panel__head">
        <h2 className="enemy-panel__name">{name}</h2>
        <span className={`chip ${type === 'boss' ? 'chip--vermilion' : type === 'elite' ? 'chip--gold' : 'chip--neutral'}`}>
          {ENEMY_TYPE_TEXT[type]}
        </span>
        <p className="enemy-panel__numbers">
          <strong className="num">{Math.max(0, currentHp).toLocaleString('zh-CN')}</strong>
          <span>/ {maxHp.toLocaleString('zh-CN')}</span>
          {lethal && <span className="chip chip--gold">可击破</span>}
        </p>
      </div>
      <div className="enemy-panel__hp">
        <div
          className="hpbar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={maxHp}
          aria-valuenow={Math.max(0, currentHp)}
          aria-label={`${name}生命`}
        >
          <div className="hpbar__ghost" style={{ width: `${ghostPercent}%` }} />
          <div className="hpbar__fill" style={{ width: `${afterPercent}%` }} />
        </div>
        {shownDamage !== null && shownDamage > 0 && (
          <p className="enemy-panel__float num" key={lastDamageToken}>
            −{shownDamage.toLocaleString('zh-CN')}
          </p>
        )}
      </div>
    </section>
  );
}
