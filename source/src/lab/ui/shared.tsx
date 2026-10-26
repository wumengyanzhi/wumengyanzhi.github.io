import type { TraceStep } from '../model';
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export const pct = (value: number | null) => value === null ? '无适用样本' : `${(100 * value).toFixed(1)}%`;
export function TraceTable({ trace }: {
    trace: readonly TraceStep[];
}) {
    return <div className="lab-table-scroll"><table><thead><tr><th>阶段 / 来源</th><th>操作</th><th>之前</th><th>之后</th><th>说明</th></tr></thead><tbody>{trace.map((t, i) => <tr key={i}><td>{t.timing}<small>{t.source}</small></td><td>{t.label}</td><td>{t.before ?? '—'}</td><td>{t.after ?? '—'}</td><td>{t.detail ?? '—'}</td></tr>)}</tbody></table>{!trace.length && <p className="lab-empty">尚无结算明细，请先预览或执行一手。</p>}</div>;
}
export function download(name: string, content: string, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
