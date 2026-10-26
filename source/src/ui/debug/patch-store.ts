import { useCallback, useMemo, useState } from 'react';
import {
  exportRuntimePatch,
  validateRuntimePatch,
  type PatchRejection,
  type RuntimePatch,
} from '@config/runtime-patch';
import { err, ok, type Result } from '@shared/result';
import { pathText, type ConfigEntry } from './config-search';

/**
 * 补丁状态。
 *
 * 三件事在这里定死：
 * 一、写入前先过一遍 RuntimePatch 的校验，类型、范围、结构性字段一律在这一步被挡下；
 * 二、撤销是「单次修改」粒度——每次改动前把整份补丁压栈，撤销就是弹回上一份；
 * 三、导出与导入走同一份 Schema，导出的文件一定能被自己收回去。
 *
 * 全部是纯函数，界面只负责调用，这样「改→撤销→回到基础值」可以被测试直接断言。
 */

export interface PatchState {
  readonly patch: RuntimePatch;
  readonly history: readonly RuntimePatch[];
  readonly rejections: readonly PatchRejection[];
}

export function createPatchState(): PatchState {
  return { patch: {}, history: [], rejections: [] };
}

function writePath(patch: RuntimePatch, path: readonly string[], value: number | boolean): RuntimePatch {
  const root: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
  let cursor = root;
  for (const key of path.slice(0, -1)) {
    const nested = cursor[key];
    cursor[key] = typeof nested === 'object' && nested !== null
      ? { ...(nested as Record<string, unknown>) }
      : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1] ?? ''] = value;
  return root as unknown as RuntimePatch;
}

function removePath(patch: RuntimePatch, path: readonly string[]): RuntimePatch {
  const keys = path;
  const root: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
  const trail: Record<string, unknown>[] = [root];
  let cursor = root;
  for (const key of keys.slice(0, -1)) {
    const nested = cursor[key];
    if (typeof nested !== 'object' || nested === null) return patch;
    cursor[key] = { ...(nested as Record<string, unknown>) };
    cursor = cursor[key] as Record<string, unknown>;
    trail.push(cursor);
  }
  delete cursor[keys[keys.length - 1] ?? ''];
  // 空掉的中间层一起摘掉，导出的补丁里不该留一堆空对象。
  for (let depth = keys.length - 1; depth > 0; depth -= 1) {
    const parent = trail[depth - 1];
    const child = trail[depth];
    const key = keys[depth - 1] ?? '';
    if (parent !== undefined && child !== undefined && Object.keys(child).length === 0) {
      delete parent[key];
    }
  }
  return root as unknown as RuntimePatch;
}

/** 输入框里的字符串先过类型与范围，再交给补丁 Schema 判结构性。 */
export function parseEntryValue(
  entry: ConfigEntry,
  raw: string,
): Result<number | boolean, string> {
  if (entry.kind === 'boolean') {
    return ok(raw === 'true' || raw === 'on');
  }
  const text = raw.trim();
  if (text === '') return err('不能为空');
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return err('必须是数字');
  if (parsed < entry.min || parsed > entry.max) {
    return err(`超出允许范围：${entry.min} ~ ${entry.max}`);
  }
  if (entry.step >= 1 && !Number.isInteger(parsed)) return err('必须是整数');
  return ok(parsed);
}

export function setEntryValue(state: PatchState, entry: ConfigEntry, raw: string): PatchState {
  if (!entry.patchable) {
    return { ...state, rejections: [{ path: pathText(entry), message: '结构性字段不可热更新' }] };
  }
  const parsed = parseEntryValue(entry, raw);
  if (!parsed.ok) {
    return { ...state, rejections: [{ path: pathText(entry), message: parsed.error }] };
  }
  const candidate = writePath(state.patch, entry.path, parsed.value);
  return commit(state, candidate);
}

export function clearEntryValue(state: PatchState, entry: ConfigEntry): PatchState {
  if (!entry.patchable) return state;
  return commit(state, removePath(state.patch, entry.path));
}

/** 只有真正改动过才记录撤销点，避免空操作把撤销栈塞满。 */
function commit(state: PatchState, candidate: RuntimePatch): PatchState {
  const validated = validateRuntimePatch(candidate);
  if (!validated.ok) {
    return { ...state, rejections: validated.error };
  }
  if (JSON.stringify(validated.value) === JSON.stringify(state.patch)) {
    return { ...state, rejections: [] };
  }
  return {
    patch: validated.value,
    history: [...state.history, state.patch],
    rejections: [],
  };
}

export function undoLast(state: PatchState): PatchState {
  const previous = state.history[state.history.length - 1];
  if (previous === undefined) return state;
  return {
    patch: previous,
    history: state.history.slice(0, -1),
    rejections: [],
  };
}

export function resetAll(): PatchState {
  return createPatchState();
}

export function importPatch(state: PatchState, raw: string): PatchState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...state, rejections: [{ path: '', message: '不是合法 JSON' }] };
  }
  return commit(state, parsed as RuntimePatch);
}

export function exportPatch(state: PatchState): string {
  return exportRuntimePatch(state.patch);
}

/** 覆盖条目数：面板顶部与「恢复全部默认」按钮靠它判断有没有改动。 */
export function countOverrides(
  paths: readonly (readonly string[])[],
  patch: RuntimePatch,
): number {
  return paths.filter((path) => readPath(patch, path) !== undefined).length;
}

function readPath(patch: RuntimePatch, path: readonly string[]): unknown {
  let node: unknown = patch;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export interface PatchStore {
  readonly state: PatchState;
  readonly setEntry: (entry: ConfigEntry, raw: string) => void;
  readonly clearEntry: (entry: ConfigEntry) => void;
  readonly undo: () => void;
  readonly reset: () => void;
  readonly importRaw: (raw: string) => void;
  readonly exportRaw: () => string;
}

/** 状态变更一律回调给外面：面板自己不认识控制器，应用外壳才知道补丁该交给谁。 */
export function usePatchStore(onChange: (patch: RuntimePatch) => void): PatchStore {
  const [state, setState] = useState<PatchState>(createPatchState);

  const apply = useCallback((next: (current: PatchState) => PatchState): void => {
    setState((current) => {
      const updated = next(current);
      if (updated.patch !== current.patch) onChange(updated.patch);
      return updated;
    });
  }, [onChange]);

  return useMemo<PatchStore>(() => ({
    state,
    setEntry: (entry, raw) => apply((current) => setEntryValue(current, entry, raw)),
    clearEntry: (entry) => apply((current) => clearEntryValue(current, entry)),
    undo: () => apply(undoLast),
    reset: () => apply(resetAll),
    importRaw: (raw) => apply((current) => importPatch(current, raw)),
    exportRaw: () => exportPatch(state),
  }), [state, apply]);
}
