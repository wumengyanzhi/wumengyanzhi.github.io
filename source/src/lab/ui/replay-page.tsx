import { useEffect, useState } from 'react';
import type { GameState } from '@domain/state/game-state';
import type { FrozenVariant, RunRecord, Scenario } from '../model';
import { replayAt, firstDivergence } from '../replay';
import { clone } from '../config-snapshot';
import { errorText, TraceTable } from './shared';
export interface ReplayTarget {
    variant: FrozenVariant;
    record: Pick<RunRecord, 'frames' | 'checkpoints'>;
    label: string;
    companion?: {
        variant: FrozenVariant;
        record: RunRecord;
    };
}
export function ReplayPage({ target, onScenario, onError }: {
    target: ReplayTarget | null;
    onScenario: (s: Scenario, v: FrozenVariant) => void;
    onError: (message: string) => void;
}) {
    const [index, setIndex] = useState(0), [state, setState] = useState<GameState | null>(null), [other, setOther] = useState<GameState | null>(null), [valid, setValid] = useState(false);
    useEffect(() => { setIndex(target?.record.frames.length ?? 0); }, [target]);
    useEffect(() => { let live = true; setValid(false); if (target)
        void Promise.all([replayAt(target.variant, target.record, index), target.companion ? replayAt(target.companion.variant, target.companion.record, Math.min(index, target.companion.record.frames.length)) : Promise.resolve(null)]).then(([a, b]) => { if (live) {
            setState(a);
            setOther(b);
            setValid(true);
        } }).catch((e) => { if (live)
            onError(errorText(e)); }); return () => { live = false; }; }, [target, index, onError]);
    if (!target)
        return <section><h2>对照与回放</h2><div className="lab-card lab-empty">从沙盘打开操作记录，或在看板选择一局样本。</div></section>;
    const frame = target.record.frames[index - 1];
    const divergent = target.companion ? firstDivergence(target.record as RunRecord, target.companion.record) : null;
    const describe = (s: GameState | null) => s ? <><p>状态：{s.run.status} · 已胜 {s.run.battlesWon} 战 · 金币 {s.run.gold}</p><p>敌人生命 {s.battle?.enemyCurrentHp ?? '—'} / {s.battle?.enemyMaxHp ?? '—'} · 剩余出战 {s.battle?.playCountRemaining ?? '—'}</p><p>手牌 {s.zones.hand.length} · 随机游标 {s.rng.cursor}</p><div className="lab-slots">{s.zones.playSlots.map((id, i) => <div key={i}>{i + 1}<strong>{id ? target.variant.config.cards.find((c) => c.id === s.cards[id]?.definitionId)?.name : '空'}</strong></div>)}</div></> : <p>尚未开局。</p>;
    return <section><div className="lab-page-heading"><div><p className="lab-eyebrow">REPLAY</p><h2>{target.label}</h2><p>{valid ? '状态校验一致' : '正在校验回放…'}</p></div><span className="lab-tag">原记录只读</span></div><div className="lab-card lab-toolbar"><button onClick={() => setIndex(0)}>局开始</button><button disabled={!index} onClick={() => setIndex(index - 1)}>上一步</button><input aria-label="回放步骤" type="range" min={0} max={target.record.frames.length} value={index} onChange={(e) => setIndex(Number(e.target.value))}/><span>{index} / {target.record.frames.length}</span><button disabled={index === target.record.frames.length} onClick={() => setIndex(index + 1)}>下一步</button>{divergent !== null && <button onClick={() => setIndex(divergent + 1)}>跳首次分歧</button>}<button className="primary" disabled={!state || !valid} onClick={() => state && onScenario({ id: crypto.randomUUID(), source: 'replay', state: clone(state), parent: target.label, note: `第 ${index} 步的副本` }, target.variant)}>从此处分支到沙盘</button></div>{target.companion && <p className="lab-muted">各侧按自己的命令时间线恢复；分歧后是不同决策路径。首次状态或动作差异：{divergent === null ? '未发现' : `第 ${divergent + 1} 步`}。</p>}<div className={target.companion ? 'lab-grid-two' : ''}><div className="lab-card"><h3>{target.variant.name}</h3>{describe(state)}</div>{target.companion && <div className="lab-card"><h3>{target.companion.variant.name}</h3>{describe(other)}</div>}</div><div className="lab-card"><h3>当前命令：{frame?.command.type ?? '开局前'}</h3><p>{frame?.decision?.reason ?? '按原始命令恢复并重放'}</p><TraceTable trace={frame?.trace ?? []}/></div><details className="lab-card"><summary>命令时间线与状态指纹</summary><table><thead><tr><th>步骤</th><th>命令</th><th>随机游标</th><th>状态指纹</th></tr></thead><tbody>{target.record.frames.map((f, i) => <tr key={i}><td><button onClick={() => setIndex(i + 1)}>{i + 1}</button></td><td>{f.command.type}</td><td>{f.rngBefore} → {f.rngAfter}</td><td><code>{f.afterHash.slice(0, 16)}</code></td></tr>)}</tbody></table></details></section>;
}
