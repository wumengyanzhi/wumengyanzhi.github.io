import { useEffect, useState, type ReactElement } from 'react';
import type { RuntimePatch } from '@config/runtime-patch';
import { effectiveValue, hasOverride, pathText, readOverride, type ConfigEntry } from './config-search';
import { hintFor } from './cluster';

/**
 * 一行参数：名字、默认值、覆盖值、生效时机。
 *
 * 三列合成一行是有意的——卡片里横向空间只够放「叫什么 + 现在是多少」。
 * 默认值退化成输入框旁边的小字，改动过的行整条染金，清除按钮只在改过时出现，
 * 这样「哪些是原始配置、哪些是自己临时拧的」照样一眼能分。
 *
 * 结构性字段没有输入框，只显示当前值并标一句「需重新加载内容」。
 */

export interface ParamRowProps {
  readonly entry: ConfigEntry;
  readonly patch: RuntimePatch;
  readonly onEdit: (entry: ConfigEntry, raw: string) => void;
  readonly onClear: (entry: ConfigEntry) => void;
  /** 所属者要不要跟着名字一起写：卡牌簇的簇名就是卡名，写了就重复。 */
  readonly withOwner: boolean;
}

export function ParamRow({
  entry,
  patch,
  onEdit,
  onClear,
  withOwner,
}: ParamRowProps): ReactElement {
  const overridden = hasOverride(entry, patch);
  const shown = effectiveValue(entry, patch);
  const override = readOverride(patch, entry.path);
  // 草稿只承载「覆盖值」：没覆盖时留空，默认值只出现在它自己那格，两列才好对照。
  const [draft, setDraft] = useState(override === undefined ? '' : String(override));

  // 撤销、恢复默认、导入都会从外部改掉覆盖值，草稿要跟着回退，否则界面会停在旧输入。
  useEffect(() => {
    setDraft(override === undefined ? '' : String(override));
  }, [override]);

  function commit(): void {
    if (draft.trim() === '') {
      if (overridden) onClear(entry);
      return;
    }
    if (override !== undefined && draft === String(override)) return;
    onEdit(entry, draft);
  }

  const hint = hintFor(entry);
  const tooltip = hint === '' ? pathText(entry) : `${hint}\n${pathText(entry)}`;

  return (
    <div className={overridden ? 'prow prow--changed' : 'prow'}>
      <span className="prow__label" title={tooltip}>
        {withOwner && entry.owner !== '' ? `${entry.owner} · ${entry.label}` : entry.label}
      </span>

      {entry.patchable ? (
        <span className="prow__ctl">
          {/*
            默认值平时只躲在输入框的 placeholder 里，卡片太窄，两列并排会挤掉参数名；
            一旦改过就把它请出来，这时候「相对默认值动了多少」才是要看的。
          */}
          {overridden && (
            <span className="prow__base" title="配置文件里的默认值">
              默认 {String(entry.base)}
            </span>
          )}
          {entry.kind === 'boolean' ? (
            <select
              className="prow__input"
              aria-label={`${entry.owner} ${entry.label} 的覆盖值`}
              title={tooltip}
              value={overridden ? String(shown) : String(entry.base)}
              onChange={(event) => onEdit(entry, event.target.value)}
            >
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
          ) : (
            <input
              className="prow__input num"
              type="number"
              aria-label={`${entry.owner} ${entry.label} 的覆盖值`}
              title={`${tooltip}\n默认值 ${String(entry.base)}`}
              placeholder={String(entry.base)}
              min={entry.min}
              max={entry.max}
              step={entry.step}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit();
              }}
            />
          )}
          {overridden && (
            <button
              type="button"
              className="prow__clear"
              aria-label={`清除 ${entry.owner} ${entry.label} 的覆盖`}
              title="清除这一项的覆盖，回到默认值"
              onClick={() => onClear(entry)}
            >
              ✕
            </button>
          )}
          {entry.timing !== 'immediate' && (
            <span className={`diff__chip diff__chip--${entry.timing}`}>
              {entry.timing === 'next_battle' ? '下场生效' : '需重载'}
            </span>
          )}
        </span>
      ) : (
        <span className="prow__ctl">
          <span className="prow__locked" title="结构性字段没有补丁入口，只能改配置文件后重新加载内容">
            {String(entry.base)}
          </span>
        </span>
      )}
    </div>
  );
}
