import type { ReactElement } from 'react';
import type { RuntimePatch } from '@config/runtime-patch';
import { hasOverride, type ConfigEntry } from './config-search';
import { TONE_TITLE, type ClusterGroup, type EntryCluster } from './cluster';
import { ParamRow } from './param-row';

/**
 * 参数卡片墙。
 *
 * 目录是一张平表，直接铺出来就只剩滚动条。这里按簇切成卡片：
 * 卡牌一张一片，规则一簇一片，卡片之间用响应式网格排，宽卡片占两格。
 * 折叠是每片独立的——默认规则簇摊开、卡牌收起，有改动或正在搜索时自动摊开，
 * 收起也能从「已改 N 项」看出哪儿动过。
 */

export interface ClusterGridProps {
  readonly groups: readonly ClusterGroup[];
  readonly patch: RuntimePatch;
  readonly onEdit: (entry: ConfigEntry, raw: string) => void;
  readonly onClear: (entry: ConfigEntry) => void;
  readonly isOpen: (cluster: EntryCluster) => boolean;
  readonly onToggle: (id: string) => void;
}

const RELATION_TONE: Readonly<Record<string, string>> = {
  本职: 'main',
  可用: 'usable',
  偏门: 'off',
  不匹配: 'none',
};

/** 5 × 5 档位表：按格子读比按 25 行读快得多。 */
function MatrixGrid({ entries }: { readonly entries: readonly ConfigEntry[] }): ReactElement {
  const rows: string[] = [];
  const cols: string[] = [];
  const cells = new Map<string, ConfigEntry>();

  for (const entry of entries) {
    const parts = entry.owner.split('×').map((part) => part.trim());
    const row = parts[0] ?? entry.owner;
    const col = parts[1] ?? '';
    if (!rows.includes(row)) rows.push(row);
    if (col !== '' && !cols.includes(col)) cols.push(col);
    cells.set(`${row}|${col}`, entry);
  }

  return (
    <table className="matrix">
      <thead>
        <tr>
          <th scope="col" className="matrix__corner" aria-label="职业" />
          {cols.map((col) => (
            <th key={col} scope="col">
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row}>
            <th scope="row" className="matrix__row">
              {row}
            </th>
            {cols.map((col) => {
              const entry = cells.get(`${row}|${col}`);
              if (entry === undefined) return <td key={col} className="matrix__cell">·</td>;
              const tone = RELATION_TONE[String(entry.base)] ?? 'none';
              return (
                <td key={col} className={`matrix__cell matrix__cell--${tone}`} title={`${entry.owner}：${String(entry.base)}`}>
                  {String(entry.base)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClusterCard({
  cluster,
  patch,
  onEdit,
  onClear,
  open,
  onToggle,
}: {
  readonly cluster: EntryCluster;
  readonly patch: RuntimePatch;
  readonly onEdit: (entry: ConfigEntry, raw: string) => void;
  readonly onClear: (entry: ConfigEntry) => void;
  readonly open: boolean;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const changed = cluster.entries.filter((entry) => hasOverride(entry, patch)).length;
  const total = cluster.sections.reduce((sum, section) => sum + section.entries.length, 0);

  return (
    <article className={`pcard pcard--${cluster.tone}`} data-open={open ? 'true' : 'false'}>
      <header className="pcard__head">
        <button
          type="button"
          className="pcard__toggle"
          aria-expanded={open}
          onClick={() => onToggle(cluster.id)}
        >
          <span className="pcard__line">
            <span className="pcard__caret" aria-hidden="true" />
            <span className="pcard__title">{cluster.title}</span>
            {cluster.badge !== '' && <span className="pcard__badge">{cluster.badge}</span>}
            {changed > 0 && (
              <span className="pcard__changed" title="这一簇里有被改过的参数">
                已改 {changed}
              </span>
            )}
          </span>
          <span className="pcard__line pcard__line--sub">
            <span className="pcard__meta">{cluster.meta}</span>
            <span className="pcard__count">{total} 项</span>
          </span>
        </button>
      </header>

      {open && (
        <div className="pcard__body">
          {cluster.sections.map((section) => (
            <div key={section.id} className="pcard__group">
              {section.title !== '' && <h5 className="pcard__group-title">{section.title}</h5>}
              {section.layout === 'matrix' ? (
                <MatrixGrid entries={section.entries} />
              ) : (
                <div
                  // 规则卡片铺满一行，参数分多列排；卡牌片窄，一列到底更稳。
                  className={
                    cluster.kind !== 'card' || section.entries.length >= 6
                      ? 'pcard__rows pcard__rows--cols'
                      : 'pcard__rows'
                  }
                >
                  {section.entries.map((entry) => (
                    <ParamRow
                      key={entry.id}
                      entry={entry}
                      patch={patch}
                      onEdit={onEdit}
                      onClear={onClear}
                      withOwner={
                        entry.owner !== ''
                        && !cluster.title.includes(entry.owner)
                        && entry.owner !== section.title
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function ClusterGrid({
  groups,
  patch,
  onEdit,
  onClear,
  isOpen,
  onToggle,
}: ClusterGridProps): ReactElement {
  return (
    <div className="tuner__sections">
      {groups.map((group) => {
        let tone = '';
        return (
          <section key={group.id} className="tuner__section">
            <header className="tuner__section-head">
              <h3 className="tuner__section-title">{group.title}</h3>
              <p className="tuner__section-hint">{group.hint}</p>
            </header>
            <div className="cluster-grid">
              {group.clusters.flatMap((cluster) => {
                // 卡牌区按人物 / 武器 / 战术分段：小标题横跨整行，卡片照旧在网格里流。
                const sub = cluster.kind === 'card' && cluster.tone !== tone ? cluster.tone : null;
                tone = cluster.tone;
                const nodes: ReactElement[] = [];
                if (sub !== null) {
                  nodes.push(
                    <h4 key={`sub-${sub}`} className="cluster-grid__sub">
                      {TONE_TITLE[sub]}
                    </h4>,
                  );
                }
                nodes.push(
                  <ClusterCard
                    key={cluster.id}
                    cluster={cluster}
                    patch={patch}
                    onEdit={onEdit}
                    onClear={onClear}
                    open={isOpen(cluster)}
                    onToggle={onToggle}
                  />,
                );
                return nodes;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
