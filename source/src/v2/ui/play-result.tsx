import type { BattleReport } from '../model';
import './battle-guidance.css';

/** Show the committed report, including when the winning play opens rewards. */
export function PlayResult({ report, expanded = false }: { report?: BattleReport; expanded?: boolean }) {
  if (!report) return null;
  return <div className="v2-last-play" role="status" aria-label="本次出战结果">
    <strong>已出战 · {report.damage.toLocaleString()} 伤害</strong>
    {report.notes[0] && <span className="v2-result-note">{report.notes[0]}</span>}
    <details open={expanded || undefined}><summary>查看本次效果</summary>
      <p>最终取整：{report.power.toLocaleString()} × {report.amp.toLocaleString()} = {report.damage.toLocaleString()}</p>
      {report.notes.map((note, index) => <p key={index}>{note}</p>)}
      {report.sources.filter(source => ['skill','equipment','enemy','charm'].includes(source.kind)).map((source, index) => <p key={index}>{source.label} {source.multiplier ? `（增幅 ×${source.multiplier}）` : ''} {source.power ? '威力 ' + (source.power > 0 ? '+' : '') + source.power : ''} {source.amp ? '增幅 ' + (source.amp > 0 ? '+' : '') + Number(source.amp.toFixed(4)) : ''}</p>)}
    </details>
  </div>;
}
