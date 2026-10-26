import { pct } from './shared';
export function StageChart({ rows, onSelect }: {
    rows: readonly {
        index: number;
        reached: number;
        conditional: number | null;
        cumulative: number | null;
        keys: string[];
    }[];
    onSelect: (keys: string[]) => void;
}) {
    return <svg className="lab-chart" viewBox="0 0 680 200" role="img" aria-label="各战条件胜率和累计通过率，实色为条件胜率，斜线为累计通过率"><defs><pattern id="lab-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e9ddd7"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9e7a6b" strokeWidth="2"/></pattern></defs>{[0, .5, 1].map((v) => <g key={v}><line x1="50" y1={160 - v * 120} x2="665" y2={160 - v * 120} stroke="#e8e4df"/><text x="6" y={165 - v * 120}>{Math.round(v * 100)}%</text></g>)}{rows.map((row, i) => <g key={row.index} tabIndex={0} role="button" aria-label={`第 ${row.index} 战：${row.reached} 局到达，查看样本`} onClick={() => onSelect(row.keys)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(row.keys);
    } }}><rect x={105 + i * 190} y={160 - (row.conditional ?? 0) * 120} width="42" height={(row.conditional ?? 0) * 120} rx="4" fill="#a34732"/><rect x={155 + i * 190} y={160 - (row.cumulative ?? 0) * 120} width="42" height={(row.cumulative ?? 0) * 120} rx="4" fill="url(#lab-hatch)"/><text x={105 + i * 190} y="185">第 {row.index} 战 · {row.reached} 局</text><title>条件 {pct(row.conditional)}；累计 {pct(row.cumulative)}</title></g>)}</svg>;
}
export function DamageChart({ values, onSelect }: {
    values: readonly {
        damage: number;
        key: string;
    }[];
    onSelect: (keys: string[]) => void;
}) {
    if (!values.length)
        return <p className="lab-empty">尚无正常样本的伤害记录。</p>;
    const max = Math.max(...values.map((v) => v.damage), 1), width = max / 6;
    const buckets = Array.from({ length: 6 }, (_, i) => { const rows = values.filter((v) => Math.min(5, Math.floor(v.damage / width)) === i); return { lo: Math.ceil(i * width), hi: Math.ceil((i + 1) * width)-1, count: rows.length, keys: [...new Set(rows.map((r) => r.key))] }; });
    const countMax = Math.max(...buckets.map((b) => b.count), 1);
    return <svg className="lab-chart" viewBox="0 0 680 200" role="img" aria-label="每手伤害分布，点击区间查看对局"><line x1="30" y1="160" x2="660" y2="160" stroke="#d7d1c9"/>{buckets.map((b, i) => <g key={i} tabIndex={0} role="button" aria-label={`伤害 ${b.lo} 至 ${b.hi}，${b.count} 手`} onClick={() => onSelect(b.keys)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(b.keys);
    } }}><rect x={35 + i * 105} y={160 - b.count / countMax * 130} width="75" height={Math.max(2, b.count / countMax * 130)} rx="4" fill="#8a6d3d"/><text x={40 + i * 105} y={150 - b.count / countMax * 130}>{b.count}</text><text x={35 + i * 105} y="183">{b.lo}–{b.hi}</text></g>)}</svg>;
}
