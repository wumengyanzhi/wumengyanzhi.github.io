import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createConfigRegistry } from '@config/config-registry';
import { freezeVariant } from '../config-snapshot';
import { LabRepository } from '../repository';
import { WorkerClient } from '../worker-client';
import { stopSnapshot } from '../batch';
import { decodeExperiment, encodeExperiment, reportCsv, reportMarkdown } from '../export';
import {ENGINE_VERSION, type BatchSnapshot, type ExperimentManifest, type FrozenVariant, type Scenario } from '../model';
import { ParameterPage } from './parameter-page';
import { SandboxPage } from './sandbox-page';
import { BatchPage } from './batch-page';
import { ReportPage } from './report-page';
import { ReplayPage, type ReplayTarget } from './replay-page';
import { download, errorText } from './shared';
import './lab.css';
const pages = [['parameters', '参数与版本'], ['sandbox', '单手沙盘'], ['batch', '批量任务'], ['report', '平衡看板'], ['replay', '对照与回放']] as const;
type Page = typeof pages[number][0];
export default function LabApp({ repository }: {
    repository?: LabRepository;
} = {}) {
    const repo = useMemo(() => repository ?? new LabRepository(), [repository]);
    const [variants, setVariants] = useState<FrozenVariant[]>([]), [selectedId, setSelected] = useState(''), [page, setPage] = useState<Page>('parameters'), [snapshot, setSnapshot] = useState<BatchSnapshot | null>(null), [scenarios, setScenarios] = useState<Scenario[]>([]), [initial, setInitial] = useState<Scenario | undefined>(), [replay, setReplay] = useState<ReplayTarget | null>(null), [notice, setNotice] = useState(''), [history, setHistory] = useState<ExperimentManifest[]>([]), [readOnly, setReadOnly] = useState(false);
    const client = useRef(new WorkerClient());
    const saveQueue = useRef(Promise.resolve());
    const onError = useCallback((message: string) => setNotice(message), []);
    useEffect(() => { let live = true; void (async () => { const loaded = createConfigRegistry(); if (!loaded.ok)
        throw new Error('原型配置无效'); const existing = await repo.variants(); let v = existing; if (!v.length) {
        v = [await freezeVariant(loaded.value.config, {}, 'A · 原型基线'), await freezeVariant(loaded.value.config, { enemyStats: { 'three_kingdoms.enemy.hu_lao_mo_jiang': { maxHp: 3200 } } }, 'B · 首领 3200')];
        for (const entry of v)
            await repo.saveVariant(entry);
    } const saved = await repo.scenarios(); const batches = await repo.batches(); if (live) {
        setVariants(v);
        setSelected(v[0]!.id);
        setScenarios(saved);
        setHistory(batches);
    } })().catch((e) => live && onError(errorText(e))); return () => { live = false; }; }, [repo, onError]);
    useEffect(() => () => client.current.dispose(), []);
    const variant = variants.find((v) => v.id === selectedId);
    function receive(s: BatchSnapshot) { setSnapshot(s); saveQueue.current = saveQueue.current.then(() => repo.saveBatch(s)).then(async () => { if (s.status !== 'running') {
        setHistory(await repo.batches());
        if (s.status === 'paused')
            setNotice('已暂停并保存，可以重载继续。');
    } }).catch((e) => { client.current.pause(); onError(errorText(e)); }); }
    async function start(manifest: ExperimentManifest) { const init = new (await import('../batch')).BatchRunner(manifest).snapshot; await repo.saveBatch(init); setReadOnly(false); setSnapshot({...init,status:'running'}); client.current.start(manifest, receive, onError); setNotice('实验已启动；在看板查看部分结果。'); }
    async function saveScenario(s: Scenario, v?: FrozenVariant) { await repo.saveScenario(s); setScenarios((old) => [...old.filter((x) => x.id !== s.id), s]); if (v) {
        setSelected(v.id);
        setVariants((old) => old.some((x) => x.id === v.id) ? old : [...old, v]);
        setInitial(s);
        setPage('sandbox');
    } setNotice('检查点副本已保存。'); }
    async function importFile(file: File) {
        if(snapshot?.status==='running'){onError('请先暂停当前任务，再导入另一个实验。');return;} try {
        setNotice('正在校验实验包、检查点和命令回放…');
        const parsed = await decodeExperiment(await file.text());
        await repo.saveBatch(parsed.snapshot);
        setSnapshot(parsed.snapshot);
        setReadOnly(parsed.readOnly);
        if (!parsed.readOnly)
            setVariants((old) => { const map = new Map(old.map((v) => [v.id, v])); parsed.snapshot.manifest.variants.forEach((v) => map.set(v.id, v)); return [...map.values()]; });
        setPage('report');
        setNotice(parsed.readOnly ? '该引擎版本未接入，只能查看报告。' : '实验包已导入，原记录保留。');
    }
    catch (e) {
        onError(errorText(e));
    } }
    return <div className="lab-shell"><aside className="lab-sidebar"><a className="lab-brand" href="?lab=1"><span>阵</span><div>数值实验室<small>神话三国 · 三战原型</small></div></a><p className="lab-sidebar-caption">工作区</p><nav>{pages.map(([key, label], i) => <button key={key} className={page === key ? 'active' : ''} aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}><span>0{i + 1}</span>{label}</button>)}</nav><div className="lab-sidebar-bottom"><span className="lab-tag">当前：20 卡 / 3 战</span><p>六战 V2、锦囊和军市<br />等待规则接入</p><a href="/">返回游戏原型 ↗</a></div></aside><div className="lab-body"><header className="lab-header"><div><strong>神话三国 / 数值实验室</strong><small>每次修改都有记录，每个异常都能回放</small></div><label>当前编辑方案<select value={selectedId} onChange={(e) => { setSelected(e.target.value); setInitial(undefined); }}>{variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label><span className="lab-version">{variant?.hash.slice(0, 8) ?? '正在准备'}</span></header><main className="lab-content">{notice && <div className="lab-notice" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}<div className="lab-global-actions"><label className="lab-file-button">导入实验包<input type="file" accept=".json" disabled={snapshot?.status==='running'} onChange={(e) => { const file = e.target.files?.[0]; if (file)
        void importFile(file); e.target.value = ''; }}/></label>{snapshot && <><button onClick={() => void encodeExperiment(snapshot).then((raw) => download(`${snapshot.manifest.name}.json`, raw)).catch((e) => onError(errorText(e)))}>导出实验包</button><button onClick={() => download(`${snapshot.manifest.name}.md`, reportMarkdown(snapshot), 'text/markdown')}>导出报告</button><button onClick={() => download(`${snapshot.manifest.name}.csv`, reportCsv(snapshot), 'text/csv')}>导出表格</button></>}{history.length > 0 && <select aria-label="打开历史实验" disabled={snapshot?.status==='running'} defaultValue="" onChange={(e) => { if (e.target.value)
        void repo.loadBatch(e.target.value).then((s) => { setSnapshot(s); setReadOnly(s.manifest.engineVersion !== ENGINE_VERSION); setPage('report'); }).catch((err) => onError(errorText(err))); e.target.value = ''; }}><option value="">打开已保存实验</option>{history.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.split}</option>)}</select>}</div>{!variant ? <div className="lab-card lab-empty">正在加载冻结方案与实验记录…</div> : <>{page === 'parameters' && <ParameterPage key={variant.id} variant={variant} onError={onError} onFreeze={async (v) => { await repo.saveVariant(v); setVariants((old) => [...old.filter((x) => x.id !== v.id), v]); setSelected(v.id); setNotice('冻结方案已保存，正在运行的实验不受影响。'); }}/>}{page === 'sandbox' && <SandboxPage key={`${variant.id}|${initial?.id ?? 'new'}`} variant={variant} initial={initial} onScenario={(s) => void saveScenario(s).catch((e) => onError(errorText(e)))} onReplay={(r) => { setReplay(r); setPage('replay'); }} onError={onError}/>} {page === 'batch' && <BatchPage key={variants.map((v) => v.id).join('|')} variants={variants} scenarios={scenarios} snapshot={snapshot} readOnly={readOnly} onStart={start} onPause={() => client.current.pause()} onStop={() => {if(snapshot?.status==='paused'){client.current.dispose();receive(stopSnapshot(snapshot));}else client.current.stop();}} onResume={() => { if (snapshot && !readOnly)
        client.current.start(snapshot.manifest, receive, onError, snapshot); }} onError={onError}/>} {page === 'report' && (snapshot ? <ReportPage key={snapshot.manifest.id} snapshot={snapshot} onReplay={(r) => { setReplay(r); setPage('replay'); }}/> : <div className="lab-card lab-empty"><h2>尚无实验报告</h2><p>先在批量任务中启动一次实验，或导入已有实验包。</p><button onClick={() => setPage('batch')}>设置批量任务</button></div>)} {page === 'replay' && <ReplayPage target={replay} onScenario={(s, v) => void saveScenario(s, v).catch((e) => onError(errorText(e)))} onError={onError}/>}</>}</main><footer className="lab-footer">本工具使用旧三战真实规则。自动策略结果需要结合真人试玩判断。</footer></div></div>;
}
