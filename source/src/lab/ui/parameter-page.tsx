import { useMemo, useState } from 'react';
import { buildCatalog, searchCatalog, effectiveValue } from '@ui/debug/config-search';
import type { RuntimePatch } from '@config/runtime-patch';
import { clone, freezeVariant, restoreConfig } from '../config-snapshot';
import type { FrozenVariant } from '../model';
import { errorText } from './shared';
export function ParameterPage({ variant, onFreeze, onError }: {
    variant: FrozenVariant;
    onFreeze: (v: FrozenVariant) => void | Promise<void>;
    onError: (message: string) => void;
}) {
    const base = useMemo(() => restoreConfig(variant.config), [variant]);
    const catalog = useMemo(() => buildCatalog(base).filter((e) => e.patchable && e.kind === 'number' && e.path[0] !== 'presentation' && !['handLimit', 'playSlotCount'].includes(e.path.at(-1) ?? '')), [base]);
    const [search, setSearch] = useState('');
    const [name, setName] = useState(`${variant.name} · 调整`);
    const [patch, setPatch] = useState<RuntimePatch>({});
    const [busy, setBusy] = useState(false);
    const entries = searchCatalog(catalog, search);
    function setValue(path: readonly string[], value: number) { const next = clone(patch) as Record<string, unknown>; let node = next; path.slice(0, -1).forEach((key) => { node[key] ??= {}; node = node[key] as Record<string, unknown>; }); node[path.at(-1)!] = value; setPatch(next as RuntimePatch); }
    async function save() { setBusy(true); try {
        await onFreeze(await freezeVariant(base, patch, name));
    }
    catch (e) {
        onError(errorText(e));
    }
    finally {
        setBusy(false);
    } }
    return <section><div className="lab-page-heading"><div><p className="lab-eyebrow">PARAMETERS</p><h2>参数与版本</h2><p>从当前方案复制修改，保存后才生成新的冻结版本。</p></div><span className="lab-tag">草稿</span></div><div className="lab-card lab-toolbar"><label>方案名称<input value={name} onChange={(e) => setName(e.target.value)}/></label><label>搜索参数<input aria-label="搜索参数" placeholder="卡名、敌人、军势或金币" value={search} onChange={(e) => setSearch(e.target.value)}/></label><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? '校验中…' : '保存冻结方案'}</button><button onClick={() => setPatch({})}>撤销草稿</button></div><div className="lab-card"><table><thead><tr><th>对象 / 参数</th><th>基线</th><th>草稿</th><th>差值</th><th>应用方式</th></tr></thead><tbody>{entries.map((entry) => { const value = effectiveValue(entry, patch) as number; const label = entry.path[0] === 'enemyStats' ? '最大生命' : entry.label; return <tr key={entry.id}><td>{entry.owner}<small>{label} · {entry.group}</small></td><td>{entry.base}</td><td><input aria-label={`${entry.owner} · ${label}`} type="number" min={entry.min} max={entry.max} step={1} value={value} onChange={(e) => setValue(entry.path, Number(e.target.value))}/></td><td className={value === entry.base ? '' : 'lab-change'}>{value - Number(entry.base) > 0 ? '+' : ''}{value - Number(entry.base)}</td><td>{entry.path[0] === 'enemyStats' ? '新局或战前副本' : '新实验 / 从检查点重建'}</td></tr>; })}</tbody></table>{!entries.length && <p className="lab-empty">未找到可编辑参数。</p>}</div><details className="lab-card"><summary>查看草稿差异</summary><pre>{JSON.stringify(patch, null, 2)}</pre></details><p className="lab-muted">运行中任务沿用已冻结配置。六战、技能语义和格位结构需要对应引擎能力。</p></section>;
}
