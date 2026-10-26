import { useMemo, useRef, useState, type ReactElement } from 'react';
import type { EffectiveConfig } from '@config/config-registry';
import { exportRuntimePatch, type RuntimePatch } from '@config/runtime-patch';
import { TIMING_TEXT, buildCatalog, hasOverride, searchCatalog } from './config-search';
import { buildClusters, filterClusters, groupClusters, type EntryCluster } from './cluster';
import { ClusterGrid } from './cluster-grid';
import { countOverrides, usePatchStore } from './patch-store';
import '../styles/debug.css';

/**
 * 开发期调参面板。
 *
 * 只做四件事：找到那个数、改它、改错了撤回来、把这份覆盖带走。
 * 面板不认识控制器，也不认识任何规则——改完的补丁交给外壳去应用到「基础配置 + 补丁」，
 * 基础配置文件一个字节都不动（硬约束：调参只生成补丁，不回写配置）。
 *
 * 目录摊平之后按语义收成卡片：卡牌一张一片，规则一簇一片，每片可独立折叠。
 * 折叠、撤销、复位、导出导入都只影响「显示到哪一层」和补丁本身，不动目录里的任何一项。
 *
 * 这个文件只在 `import.meta.env.DEV` 下被动态导入，生产构建里连入口都不存在。
 */

export interface PatchPanelProps {
  readonly baseConfig: EffectiveConfig;
  readonly onChange: (patch: RuntimePatch) => void;
  readonly onClose: () => void;
}

const TIMING_ORDER = ['immediate', 'next_battle', 'reload'] as const;

export default function PatchPanel({ baseConfig, onChange, onClose }: PatchPanelProps): ReactElement {
  const catalog = useMemo(() => buildCatalog(baseConfig), [baseConfig]);
  const clusters = useMemo(() => buildClusters(catalog), [catalog]);
  const [query, setQuery] = useState('');
  const store = usePatchStore(onChange);
  const fileRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => searchCatalog(catalog, query), [catalog, query]);
  const visible = useMemo(() => filterClusters(clusters, matches), [clusters, matches]);
  const groups = useMemo(() => groupClusters(visible), [visible]);
  const overrideCount = useMemo(
    () => countOverrides(catalog.map((entry) => entry.path).filter((path) => path.length > 0), store.state.patch),
    [catalog, store.state.patch],
  );

  // 折叠状态：每片一个显式开关，另有「全部展开 / 全部折叠」压在上面。
  // 规则簇默认摊开，卡牌默认收起——除非正在搜索，或者这一片里有被改过的参数。
  const [openOverride, setOpenOverride] = useState<Readonly<Record<string, boolean>>>({});
  const [bulk, setBulk] = useState<boolean | null>(null);
  const searching = query.trim() !== '';

  function isOpen(cluster: EntryCluster): boolean {
    const explicit = openOverride[cluster.id];
    if (explicit !== undefined) return explicit;
    if (bulk !== null) return bulk;
    if (cluster.kind !== 'card') return true;
    return searching || cluster.entries.some((entry) => hasOverride(entry, store.state.patch));
  }

  function toggle(id: string): void {
    const cluster = clusters.find((item) => item.id === id);
    if (cluster === undefined) return;
    setOpenOverride((current) => ({ ...current, [id]: !isOpen(cluster) }));
  }

  const allOpen = visible.every(isOpen);

  function toggleAll(): void {
    setBulk(allOpen ? false : true);
    setOpenOverride({});
  }

  function download(): void {
    const content = exportRuntimePatch(store.state.patch);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'runtime-patch.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="scrim tuner__scrim" role="dialog" aria-label="调参面板">
      <div className="tuner">
        <header className="tuner__head">
          <div>
            <h2 className="tuner__title">调参面板</h2>
            <p className="tuner__sub">
              改动只生成运行时补丁，不写回配置文件；刷新页面即全部丢失，想留着就用「导出」。
            </p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="tuner__bar">
          <input
            className="tuner__search"
            type="search"
            placeholder="按 ID、名称或字段路径搜索，例如 环首刀 / maxHp / morale"
            aria-label="搜索配置项"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // 一敲搜索，之前那次「全部折叠 / 全部展开」就不再作数：命中的卡片该自己摊开。
              setBulk(null);
            }}
          />
          <span className="tuner__count">
            命中 {matches.length} 项 · 已覆盖 {overrideCount} 项
          </span>
          <button type="button" className="btn btn--ghost" onClick={toggleAll}>
            {allOpen ? '全部折叠' : '全部展开'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={store.state.history.length === 0}
            onClick={store.undo}
          >
            撤销上一次修改
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={overrideCount === 0}
            onClick={store.reset}
          >
            恢复全部默认
          </button>
          <button type="button" className="btn btn--ghost" onClick={download}>
            导出补丁
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
            导入补丁
          </button>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file === undefined) return;
              store.importRaw(await file.text());
              event.target.value = '';
            }}
          />
        </div>

        <div className="tuner__legend" role="note">
          {TIMING_ORDER.map((timing) => (
            <span key={timing} className={`diff__chip diff__chip--${timing}`}>
              {TIMING_TEXT[timing]}
            </span>
          ))}
          <span className="tuner__legend-hint">
            标着「需重新加载内容」的字段没有补丁入口，只能改配置文件后刷新。
          </span>
        </div>

        {store.state.rejections.length > 0 && (
          <div className="tuner__errors" role="alert">
            {store.state.rejections.map((rejection) => (
              <p key={`${rejection.path}-${rejection.message}`}>
                <code>{rejection.path === '' ? '补丁' : rejection.path}</code>
                {rejection.message}
              </p>
            ))}
          </div>
        )}

        <div className="tuner__body">
          {groups.length === 0 ? (
            <p className="diff__empty">没有命中的配置项。</p>
          ) : (
            <ClusterGrid
              groups={groups}
              patch={store.state.patch}
              onEdit={store.setEntry}
              onClear={store.clearEntry}
              isOpen={isOpen}
              onToggle={toggle}
            />
          )}
        </div>
      </div>
    </div>
  );
}
