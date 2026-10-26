import { useState } from 'react';
import { createManifest } from '../capabilities';
import type { BatchSnapshot, ExperimentManifest, FrozenVariant, PolicyId, Scenario } from '../model';
import { errorText } from './shared';
export function BatchPage({ variants, scenarios, snapshot, readOnly=false, onStart, onResume, onPause, onStop, onError }: {
    variants: readonly FrozenVariant[];
    scenarios: readonly Scenario[];
    snapshot: BatchSnapshot | null;
    readOnly?:boolean;
    onStart: (m: ExperimentManifest) => void | Promise<void>;
    onResume: () => void;
    onPause: () => void;
    onStop: () => void;
    onError: (message: string) => void;
}) {
    const [selected, setSelected] = useState<string[]>(variants.slice(0, 2).map((v) => v.id)), [policies, setPolicies] = useState<PolicyId[]>(['legacy_match_v1', 'visible_damage_v1']), [count, setCount] = useState(100), [split, setSplit] = useState<'exploration' | 'holdout'>('exploration'), [name, setName] = useState('三战首领生命对照'), [customSeeds, setCustomSeeds] = useState(''), [mode, setMode] = useState<ExperimentManifest['mode']>('whole-run'), [sceneId, setSceneId] = useState(scenarios[0]?.id ?? ''), [busy, setBusy] = useState(false);
    const active = snapshot?.status === 'running';
    const statusNames = { running: '运行中', paused: '已暂停', stopped: '已停止', completed: '已结束' };
    const n = mode === 'whole-run' ? (customSeeds.trim() ? new Set(customSeeds.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)).size : count) : 1;
    async function start() { setBusy(true); try {
        const scenario = scenarios.find((s) => s.id === sceneId);
        const seeds = mode === 'whole-run' ? (customSeeds.trim() ? customSeeds.split(/[\n,]+/) : Array.from({ length: count }, (_, i) => `lab-${split}-${String(i).padStart(4, '0')}`)) : [scenario?.state.rng.seed ?? ''];
        const fixedCommands = mode === 'same-action' ? [{ type: 'Play' as const, assignments: scenario?.state.zones.playSlots.flatMap((id, slotIndex) => id ? [{ slotIndex, instanceId: id }] : []) ?? [] }] : undefined;
        const m = await createManifest({ name, variants: variants.filter((v) => selected.includes(v.id)), policies, seeds, split, mode, scenario: mode === 'whole-run' ? undefined : scenario, fixedCommands });
        await onStart(m);
    }
    catch (e) {
        onError(errorText(e));
    }
    finally {
        setBusy(false);
    } }
    return <section><div className="lab-page-heading"><div><p className="lab-eyebrow">EXPERIMENTS</p><h2>批量任务</h2><p>先固定问题、方案、打法与种子，再启动实验。</p></div><span className="lab-tag">一套 20 卡 · 三战</span></div><div className="lab-card lab-form"><label>实验名称<input value={name} onChange={(e) => setName(e.target.value)}/></label><fieldset><legend>参数方案</legend>{variants.map((v) => <label className="lab-check" key={v.id}><input type="checkbox" checked={selected.includes(v.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, v.id] : selected.filter((id) => id !== v.id))}/>{v.name}<small>{v.hash.slice(0, 8)}</small></label>)}</fieldset><fieldset><legend>自动打法</legend>{(['legacy_match_v1', 'visible_damage_v1'] as const).map((p) => <label className="lab-check" key={p}><input type="checkbox" checked={policies.includes(p)} onChange={(e) => setPolicies(e.target.checked ? [...policies, p] : policies.filter((id) => id !== p))}/>{p === 'legacy_match_v1' ? '旧匹配基线' : '受限即时伤害搜索'}</label>)}<p className="lab-muted">两种首版策略都不主动弃牌；结果不能代表所有打法的上限。</p></fieldset><div className="lab-grid-two"><label>实验模式<select value={mode} onChange={(e) => setMode(e.target.value as ExperimentManifest['mode'])}><option value="whole-run">同种子整局：比较总效果</option><option value="battle">同战前状态：策略重新决策</option><option value="same-action">同局面与动作：比较单手效果</option></select></label><label>种子用途<select value={split} onChange={(e) => setSplit(e.target.value as 'exploration' | 'holdout')}><option value="exploration">调参探索集</option><option value="holdout">独立验证集</option></select></label></div>{mode === 'whole-run' ? <><label>每个方案与打法的种子数<input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(Number(e.target.value))}/></label><details><summary>使用指定种子表</summary><textarea aria-label="指定种子表" value={customSeeds} onChange={(e) => setCustomSeeds(e.target.value)} placeholder="每行一个种子，重复项会去除"/></details></> : <label>已保存检查点<select value={sceneId} onChange={(e) => setSceneId(e.target.value)}><option value="">先在沙盘保存检查点</option>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.note ?? s.id} · {s.state.rng.seed}</option>)}</select><small>{mode === 'battle' ? '要求尚未出战且格位为空的战前副本。' : '要求检查点已摆好牌；使用其原种子，一份局面只计一次。'}</small></label>}<div className="lab-launch"><div><strong>{selected.length} × 1 × {policies.length} × {n} = {selected.length * policies.length * n} 局</strong><p>方案 × 起手 × 打法 × 独立种子</p></div><button className="primary" disabled={active || busy} onClick={() => void start()}>冻结清单并开始</button></div></div>{snapshot && <div className="lab-card lab-progress"><div className="lab-toolbar"><h3>{snapshot.manifest.name}</h3><span className="lab-tag">{statusNames[snapshot.status]}</span></div><progress max={snapshot.manifest.plannedRuns} value={snapshot.records.filter((r) => !['pending', 'running', 'paused'].includes(r.status)).length}/><p>已结束 {snapshot.records.filter((r) => !['pending', 'running', 'paused'].includes(r.status)).length} / {snapshot.manifest.plannedRuns} · 正常胜负 {snapshot.records.filter((r) => r.status === 'completed' && r.outcome).length} · 异常 {snapshot.records.filter((r) => ['error', 'timeout', 'budget_exceeded'].includes(r.status)).length}</p><p className="lab-muted">正在测试冻结清单，面板编辑将用于另一批实验。</p><div className="lab-toolbar"><button disabled={!active} onClick={onPause}>暂停并保存</button><button disabled={snapshot.status !== 'paused'||readOnly} onClick={onResume}>继续原任务</button><button disabled={readOnly||!active && snapshot.status !== 'paused'} onClick={onStop}>停止任务</button></div></div>}</section>;
}
