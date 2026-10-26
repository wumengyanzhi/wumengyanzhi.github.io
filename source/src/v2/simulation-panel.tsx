import { useRef, useState } from 'react';
import { CARD_MAP, DECKS, ENEMIES } from './data';
import { simulateRun, summarizeRuns } from './simulation';
import type { AutoPolicy, SimulationResult } from './simulation';
import './simulation.css';

const percent = (value: number | null) => value === null ? '无适用样本' : `${(value * 100).toFixed(1)}%`;
export default function SimulationPanel() {
  const [deckId, setDeckId] = useState(DECKS[0]!.id);
  const [policy, setPolicy] = useState<AutoPolicy>('matching');
  const [prefix, setPrefix] = useState('远征验证');
  const [count, setCount] = useState(5);
  const [results, setResults] = useState<SimulationResult[]>([]);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const stop = useRef(false);
  const report = summarizeRuns(results);
  async function run() {
    if (running || !prefix.trim() || !Number.isInteger(count) || count < 1 || count > 20) return;
    stop.current = false; setRunning(true); setSelected(null); setResults([]);
    const records: SimulationResult[] = [];
    try {
      for (let index = 0; index < count && !stop.current; index++) {
        await new Promise(resolve => setTimeout(resolve, 30));
        if (stop.current) break;
        records.push(simulateRun({ deckId, seed: `${prefix.trim()}:${index + 1}`, policy }));
        setResults([...records]);
      }
    } finally { setRunning(false); }
  }
  function download() {
    const packageData = { version: 1, ruleset: 'mobile_v2', description: '固定公开状态策略、同一 V2 结算引擎；不代表真人试玩', deckId, policy, report, results };
    const url = URL.createObjectURL(new Blob([JSON.stringify(packageData, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = '五阵破军-十八局演练.json'; link.click(); URL.revokeObjectURL(url);
  }
  const record = selected === null ? null : results[selected] ?? null;
  return <section className="v2-simulation" aria-label="十八局数值演练">
    <p className="sim-eyebrow">THE PROVING GROUND</p><h2>沙场演练</h2>
    <p>固定种子，使用游戏实际规则完成十八局、选卡、强化和军市。每个样本都保留出战记录。</p>
    <div className="sim-form">
      <label>起始构筑<select value={deckId} disabled={running} onChange={e => setDeckId(e.target.value)}>{DECKS.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
      <label>自动打法<select value={policy} disabled={running} onChange={e => setPolicy(e.target.value as AutoPolicy)}><option value="matching">匹配与即时伤害</option><option value="growth">成长与一次主动换牌</option></select></label>
      <label>种子前缀<input value={prefix} maxLength={180} disabled={running} onChange={e => setPrefix(e.target.value)} /></label>
      <label>样本数（1–20）<input type="number" value={count} min={1} max={20} disabled={running} onChange={e => setCount(Number(e.target.value))} /></label>
    </div>
    <p className="sim-note">两种打法每手最多搜索 256 种阵型，使用公开手牌，不读取隐藏牌序；成长打法主动换牌一次。它们有明确局限，自动通关率无法证明真人乐趣或 10–15 分钟局长。</p>
    <div className="sim-actions"><button onClick={() => void run()} disabled={running || !prefix.trim() || !Number.isInteger(count) || count < 1 || count > 20}>{running ? `演练中 ${results.length} / ${count}` : '开始固定种子演练'}</button>{running && <button onClick={() => { stop.current = true; }}>在本局后停止</button>}<button disabled={!results.length || running} onClick={download}>导出完整记录</button></div>
    <div className="sim-kpis" aria-live="polite"><div><span>正常完成</span><strong>{report.completed} / {report.total}</strong></div><div><span>胜 / 负</span><strong>{report.wins} / {report.losses}</strong></div><div><span>通关率</span><strong>{percent(report.winRate)}</strong></div><div><span>错误 / 超预算</span><strong>{report.errors} / {report.budgets}</strong></div></div>
    <p className="sim-note">胜率分母仅含正常胜负；未运行的样本不计入，错误和预算超限单列。重复种子去重 {report.duplicates} 个。</p>
    <div className="sim-stages">{report.stages.map(row => <div className="sim-stage" key={row.index}><span>{row.index + 1} · {ENEMIES[row.index]!.name}</span><div className="sim-bar"><i style={{ width: `${row.conditional === null ? 0 : row.conditional * 100}%` }} /></div><small>{row.won} 胜 / {row.reached} 到达 · {percent(row.conditional)}</small></div>)}</div>
    {results.length > 0 && <div className="sim-table"><table><thead><tr><th>种子</th><th>结果</th><th>到达</th><th>出战</th><th>明细</th></tr></thead><tbody>{results.map((r, i) => <tr key={`${r.seed}:${i}`}><td>{r.seed}</td><td>{r.status !== 'completed' ? r.status === 'error' ? '执行错误' : '预算超限' : r.state.phase === 'won' ? '通关' : '战败'}</td><td>第 {r.state.battleIndex + 1} 战</td><td>{r.state.battles.reduce((sum, b) => sum + b.plays, 0)} 次</td><td><button onClick={() => setSelected(i)}>查看记录</button></td></tr>)}</tbody></table></div>}
    {record && <div className="sim-record"><div className="sim-actions"><h3>{record.seed} · 逐战记录</h3><button onClick={() => setSelected(null)}>收起记录</button></div>{record.error && <p role="alert">{record.error}</p>}{record.state.battles.map(b => <details key={b.index}><summary>第 {b.index + 1} 战 · {ENEMIES[b.index]!.name} · {b.won ? '获胜' : `剩余敌血 ${b.remainingHp}`} · {b.plays} 次出战</summary>{b.reports.map((r, i) => <div className="sim-play" key={i}><strong>第 {i + 1} 手 · {r.power} 威力 × {r.amp} 增幅 = {r.damage.toLocaleString()}</strong><p>{r.playedIds.map(id => CARD_MAP[record.state.cards[id]!.definitionId]!.name).join(' · ')}</p>{r.sources.map((s, j) => <small key={j}>{s.label}：{s.power ? `威力 ${s.power > 0 ? '+' : ''}${s.power}` : ''} {s.amp ? `增幅 ${s.amp > 0 ? '+' : ''}${s.amp}` : ''}{s.multiplier ? ` ×${s.multiplier}` : ''}</small>)}{r.notes.map((note, j) => <p key={j}>{note}</p>)}</div>)}</details>)}<details><summary>金币账本与命令</summary>{record.state.log.filter(l => l.goldDelta).map(l => <p key={l.id}>{l.text}：{l.goldDelta > 0 ? '+' : ''}{l.goldDelta}</p>)}<p>共 {record.commands.length} 条提交命令。导出的完整记录含所有命令与最终状态，可复现相同种子。</p></details></div>}
  </section>;
}
