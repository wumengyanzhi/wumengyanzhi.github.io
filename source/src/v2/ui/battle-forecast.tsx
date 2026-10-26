import type { BattlePreview } from '../model';
import type { CSSProperties } from 'react';

export function BattleForecast({ preview, prearranging, hasCards, onDetails }: { preview: BattlePreview; prearranging: boolean; hasCards: boolean; onDetails: () => void }) {
  const report = preview.report;
  const value = (number: number) => number.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
  const size = (number: number): CSSProperties => ({ '--term-digits': Math.max(3, value(number).length) } as CSSProperties);
  return <section className="v2-preview v2-forecast" aria-label="伤害预览">
    <small className="v2-forecast-caption">{prearranging ? '预排伤害' : '预计伤害'}</small>
    <div className="v2-forecast-equation" aria-live="polite" aria-atomic="true">
      <span className="v2-forecast-term v2-forecast-power" style={size(report?.power ?? 0)}><strong>{value(report?.power ?? 0)}</strong><small>威力</small></span>
      <i aria-hidden="true">×</i>
      <span className="v2-forecast-term v2-forecast-amp" style={size(report?.amp ?? 0)}><strong>{value(report?.amp ?? 0)}</strong><small>增幅</small></span>
      <i aria-hidden="true">=</i>
      <span className="v2-forecast-term v2-forecast-damage" style={size(report?.damage ?? 0)}><strong className="v2-forecast-number" key={report?.damage ?? 0}>{value(report?.damage ?? 0)}</strong><small>伤害</small></span>
    </div>
    <button aria-label="结算明细 ↗" onClick={onDetails}>明细 ↗</button>
    {hasCards && preview.error && <span className="v2-forecast-error" role="status">{preview.error}</span>}
  </section>;
}
