import { useEffect, useRef, useState } from 'react';
import type { GameCommand } from '@app/game-controller';
import type { GameState } from '@domain/state/game-state';
import type { InstanceId } from '@domain/models/ids';
import { LabEngine } from '../engine-adapter';
import { clone, fingerprint } from '../config-snapshot';
import type { Checkpoint, FrozenVariant, RunFrame, Scenario, TraceStep } from '../model';
import type { ReplayTarget } from './replay-page';
import { errorText, TraceTable } from './shared';
import { FixtureEditor } from './fixture-editor';
export function SandboxPage({ variant, initial, onScenario, onReplay, onError }: {
    variant: FrozenVariant;
    initial?: Scenario;
    onScenario: (s: Scenario) => void;
    onReplay: (target: ReplayTarget) => void;
    onError: (message: string) => void;
}) {
    const engine = useRef<LabEngine | null>(null);
    const locked = useRef(false);
    const [state, setState] = useState<GameState | null>(null), [selected, setSelected] = useState<InstanceId | null>(null), [seed, setSeed] = useState('sandbox-001'), [busy, setBusy] = useState(false), [diagOpen, setDiagOpen] = useState(false), [origin, setOrigin] = useState<Scenario['source']>(initial?.source ?? 'seed'), [trace, setTrace] = useState<readonly TraceStep[]>([]), [preview, setPreview] = useState<{
        damage: number;
        powerTotal: number;
        ampTotal: number;
    } | null>(null);
    const frames = useRef<RunFrame[]>([]), checkpoints = useRef<Checkpoint[]>([]);
    async function dispatch(command: GameCommand) {
        if (locked.current || !engine.current)
            return;
        locked.current = true;
        setBusy(true);
        try {
            const before = engine.current.state, beforeHash = await fingerprint(before);
            const result = engine.current.dispatch(command), afterHash = await fingerprint(result.state);
            const frame: RunFrame = { command, beforeHash, afterHash, events: result.events, trace: result.trace, battleIndex: (before?.run.battlesWon ?? 0) + 1, enemyHpBefore: before?.battle?.enemyCurrentHp ?? null, goldBefore: before?.run.gold ?? engine.current.config.economy.initialGold, goldAfter: result.state.run.gold, rngBefore: before?.rng.cursor ?? 0, rngAfter: result.state.rng.cursor };
            frames.current.push(frame);
            checkpoints.current.push({ afterFrames: frames.current.length, state: clone(result.state), hash: afterHash });
            setState(result.state);
            setTrace(result.trace);
            setPreview(null);
            setSelected(null);
        }
        catch (e) {
            onError(errorText(e));
        }
        finally {
            locked.current = false;
            setBusy(false);
        }
    }
    async function reset() { if (locked.current)
        return; setOrigin(initial?.source ?? 'seed'); frames.current = []; checkpoints.current = []; try {
        engine.current = new LabEngine(variant, initial?.state);
        setTrace([]);
        setPreview(null);
        setSelected(null);
        if (initial) {
            checkpoints.current = [{ afterFrames: 0, state: clone(initial.state), hash: await fingerprint(initial.state) }];
            setState(engine.current.state);
        }
        else
            await dispatch({ type: 'NewRun', seed });
    }
    catch (e) {
        onError(errorText(e));
    } }
    useEffect(() => { void reset(); }, [variant, initial]);
    const assignments = state?.zones.playSlots.flatMap((id, slotIndex) => id ? [{ slotIndex, instanceId: id }] : []) ?? [];
    const cardName = (id: InstanceId) => variant.config.cards.find((c) => c.id === state?.cards[id]?.definitionId)?.name ?? id;
    function showPreview() { try {
        const p = engine.current!.preview(assignments);
        setTrace(p.trace);
        setPreview(p);
        setDiagOpen(true);
    }
    catch (e) {
        onError(errorText(e));
    } }
    const targets = engine.current?.controller.weaponTargets() ?? [];
    return <section><div className="lab-page-heading"><div><p className="lab-eyebrow">SANDBOX</p><h2>单手沙盘</h2><p>{initial ? `${initial.source === 'fixture' ? '人工场景' : '检查点副本'} · ${initial.note ?? initial.parent ?? initial.id}` : '固定种子开局，用真实规则试算一手牌。'}</p></div><span className="lab-tag">{origin === 'fixture' ? '人工场景 · 不计自然胜率' : '隔离副本'}</span></div><div className="lab-card lab-toolbar"><label>开局种子<input disabled={!!initial || busy} value={seed} onChange={(e) => setSeed(e.target.value)}/></label><button disabled={busy} onClick={() => void reset()}>重置沙盘</button><button disabled={!state || busy} onClick={() => state && onScenario({ id: crypto.randomUUID(), source: origin, state: clone(state), note: '保存的沙盘检查点' })}>保存检查点</button><button disabled={!frames.current.length || busy} onClick={() => onReplay({ variant, record: { frames: clone(frames.current), checkpoints: clone(checkpoints.current) }, label: '沙盘操作回放' })}>打开操作回放</button></div><FixtureEditor state={state} variant={variant} disabled={busy} onError={onError} onApply={async (next, source) => { if (locked.current)
        return; locked.current = true; setBusy(true); try {
        const copy = new LabEngine(variant, next);
        const hash = await fingerprint(copy.state);
        engine.current = copy;
        frames.current = [];
        checkpoints.current = [{ afterFrames: 0, state: clone(copy.state!), hash }];
        setState(copy.state);
        setOrigin(source);
        setSelected(null);
        setTrace([]);
        setPreview(null);
    }
    finally {
        locked.current = false;
        setBusy(false);
    } }}/><div className="lab-sandbox-grid"><div><div className="lab-card"><div className="lab-battle-summary"><h3>{state?.battle ? variant.config.enemies.find((e) => e.id === state.battle!.enemyDefinitionId)?.name : '战后选择 / 已结束'}</h3><strong>{state?.battle?.enemyCurrentHp ?? '—'} / {state?.battle?.enemyMaxHp ?? '—'}</strong></div><div className="lab-resource-row"><span>剩余出战 {state?.battle?.playCountRemaining ?? '—'}</span><span>弃牌 {state?.battle?.discardCountRemaining ?? '—'}</span><span>军势 {state?.battle?.moraleTotal ?? '—'}</span><span>金币 {state?.run.gold ?? '—'}</span></div><div className="lab-slots">{(state?.zones.playSlots ?? Array(5).fill(null)).map((id: InstanceId | null, i: number) => <button key={i} aria-label={`格位 ${i + 1}：${id ? cardName(id) : '空'}`} disabled={busy} onClick={() => void dispatch(id ? { type: 'UnstageCard', slotIndex: i } : selected ? { type: 'StageCard', slotIndex: i, instanceId: selected } : { type: 'UnstageCard', slotIndex: i })}><span>{String(i + 1).padStart(2, '0')}</span><strong>{id ? cardName(id) : selected ? '点此放入' : '空位'}</strong></button>)}</div>{targets.map((t) => <label key={t.weaponInstanceId}>{cardName(t.weaponInstanceId)} 装备给<select aria-label={`${cardName(t.weaponInstanceId)} 装备目标`} value={state?.equipmentTargets[t.weaponInstanceId] ?? ''} onChange={(e) => void dispatch({ type: 'SelectWeaponTarget', weaponInstanceId: t.weaponInstanceId, targetInstanceId: e.target.value as InstanceId })}><option value="" disabled>请选择相邻人物</option>{t.candidateInstanceIds.map((id) => <option key={id} value={id}>{cardName(id)}</option>)}</select></label>)}<div className="lab-toolbar lab-action-row"><button className="lab-drawer-toggle" onClick={() => setDiagOpen(!diagOpen)}>结算明细</button><button disabled={busy || !assignments.length} onClick={showPreview}>预览</button><button className="primary" disabled={busy || !assignments.length} onClick={() => void dispatch({ type: 'Play', assignments })}>执行一手</button><button disabled={busy || !selected || !(state?.battle?.discardCountRemaining)} onClick={() => selected && void dispatch({ type: 'Discard', instanceIds: [selected] })}>弃掉选中牌</button></div></div><div className="lab-card"><h3>手牌 <span className="lab-muted">点牌，再点空位；点占用格位收回</span></h3><div className="lab-hand">{state?.zones.hand.map((id) => { const definition = variant.config.cards.find((c) => c.id === state.cards[id]?.definitionId); const card = state.cards[id]!; return <button key={id} aria-label={`手牌 ${cardName(id)}`} className={`lab-playing-card ${selected === id ? 'selected' : ''}`} disabled={busy} onClick={() => setSelected(selected === id ? null : id)}><small>{definition?.cardType === 'character' ? '人物' : definition?.cardType === 'weapon' ? '武器' : '战术'}</small><strong>{cardName(id)}</strong><span>威力 {(definition?.basePower ?? 0) + card.permanentPower} · 增幅 {(definition && 'baseAmp' in definition ? definition.baseAmp : 0) + card.permanentAmp}</span></button>; })}</div>{state?.pendingChoice?.kind === 'enhancement_reward' && <div className="lab-rewards"><h3>战后强化</h3>{state.pendingChoice.candidates.map((c) => <button key={c.id} disabled={busy} onClick={() => void dispatch({ type: 'ChooseEnhancement', candidateId: c.id })}>{cardName(c.targetInstanceId)} · {c.attribute === 'power' ? '威力' : '增幅'} +{c.amount}{c.skillId ? ' / 附加技能' : ''}</button>)}</div>}{state?.run.status !== 'running' && state && <p className="lab-empty">本局{state.run.status === 'won' ? '通关' : '失败'}，可以查看回放或重置。</p>}</div></div><aside className={`lab-card lab-diagnostics ${diagOpen ? 'is-open' : ''}`}><div className="lab-toolbar"><h3>伤害解释</h3><button className="lab-drawer-toggle" onClick={() => setDiagOpen(false)}>关闭明细</button></div>{preview ? <div className="lab-damage"><span>预计伤害</span><strong>{preview.damage.toLocaleString()}</strong><p>{preview.powerTotal} 威力 × {preview.ampTotal} 增幅</p></div> : <p className="lab-muted">先预览一手，查看真实运算路径。</p>}<p className="lab-muted">效果变化与伤害汇总分阶段记录，同一加值不能重复累加。</p><TraceTable trace={trace}/></aside></div></section>;
}
