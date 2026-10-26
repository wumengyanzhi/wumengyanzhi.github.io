import { useRef, useState } from 'react';
import { createTutorial, parseTutorial, serializeTutorial, TUTORIAL_KEY, updateTutorial } from '../tutorial';
import type { TutorialEvent, TutorialSession } from '../tutorial';

function loadTutorial() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TUTORIAL_KEY);
    return { session: raw ? parseTutorial(raw) : createTutorial(), raw, error: '' };
  } catch {
    return { session: null, raw, error: '教学存档无法读取，原始内容已保留。点击“重新演武”可重新学习，正式远征不受影响。' };
  }
}

/** The lesson has its own save transaction; it never commits a formal run. */
export function useTutorial() {
  const [loaded] = useState(loadTutorial);
  const [session, setSession] = useState<TutorialSession | null>(loaded.session);
  const current = useRef(session);
  const baseline = useRef(loaded.raw);
  const [error, setError] = useState(loaded.error);
  const [epoch, setEpoch] = useState(0);
  const commit = (next: TutorialSession, replace = false) => {
    try {
      if (!replace && localStorage.getItem(TUTORIAL_KEY) !== baseline.current) {
        setError('教学已在另一页面更新。本次操作尚未生效，请读取最新教学进度。'); return false;
      }
      const raw = serializeTutorial(next);
      localStorage.setItem(TUTORIAL_KEY, raw);
      baseline.current = raw; current.current = next; setSession(next); setError(''); return true;
    } catch { setError('教学保存失败，操作尚未生效。请检查设备存储后重试。'); return false; }
  };
  const dispatch = (event: TutorialEvent) => {
    if (!current.current) return false;
    const result = updateTutorial(current.current, event);
    if (!result.ok) { setError(result.error ?? '请先完成当前教学目标。'); return false; }
    return result.session !== current.current ? commit(result.session) : true;
  };
  const restart = () => { commit(createTutorial(), true); setEpoch(value => value + 1); };
  const reload = () => {
    const latest = loadTutorial(); baseline.current = latest.raw; current.current = latest.session;
    setSession(latest.session); setError(latest.error); setEpoch(value => value + 1);
  };
  return { session, dispatch, restart, reload, error, epoch };
}
