import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CARD_MAP } from '../data';
import type { BattleChoice, RunState } from '../model';
import type { SkillCue, SkillCueState } from './battle-guidance';
import { getCardRuleText } from './card-copy';
import { SKILL_TEXT } from './primitives';
import './skill-panel.css';

const STATES: Record<SkillCueState, string> = { ready: '已就绪', waiting: '未满足', used: '已使用', choose: '待指定', optional: '可选发动', passive: '被动' };
const MARKS: Record<SkillCueState, string> = { ready: '✓', waiting: '▣', used: '−', choose: '⌖', optional: '☞', passive: '∞' };
interface Props { cues: SkillCue[]; selecting: string | null; disabled: boolean; select: (choice: BattleChoice) => void; cancelEffect: (choice: BattleChoice) => void; state?: RunState; holdMs?: number; children?: ReactNode; }
interface Inspection { id: string; anchor: HTMLElement; mode: 'hover' | 'pinned'; }

function sourceDefinition(cue: SkillCue, state?: RunState) {
  const instance = state?.cards[cue.sourceId];
  return instance ? CARD_MAP[instance.definitionId] : Object.values(CARD_MAP).find(card => card.name === cue.sourceName);
}

function isCommandCue(cue: SkillCue, state?: RunState) {
  const skill = sourceDefinition(cue, state)?.skill;
  return cue.id.startsWith('skill:') && (skill === 'pang_tong' || skill === 'sun_shang_xiang');
}

/** Keep source order independent of target priority and all status changes. */
function orderedCues(cues: SkillCue[], state?: RunState) {
  const sources = [...new Set(cues.map(cue => cue.sourceId))];
  const slots = state?.battle?.slots ?? sources;
  const position = (source: string) => { const index = slots.indexOf(source); return index < 0 ? slots.length + sources.indexOf(source) : index; };
  return cues.map((cue, index) => ({ cue, index })).sort((a, b) => position(a.cue.sourceId) - position(b.cue.sourceId)
    || Number(!a.cue.id.startsWith('skill:')) - Number(!b.cue.id.startsWith('skill:')) || a.index - b.index).map(({ cue }) => cue);
}

export function SkillPanel({ cues, selecting, disabled, select, cancelEffect, state, holdMs = 450, children }: Props) {
  const [open, setOpen] = useState<Inspection | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const detail = useRef<HTMLDivElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef<{ x: number; y: number } | null>(null);
  const touch = useRef(false);
  const id = useId();
  const clearHold = useCallback(() => { clearTimeout(hold.current); hold.current = undefined; press.current = null; }, []);
  const dismiss = useCallback(() => { clearHold(); clearTimeout(leave.current); setOpen(null); }, [clearHold]);
  const active = cues.find(cue => cue.id === open?.id);
  const show = (cue: SkillCue, anchor: HTMLElement, mode: Inspection['mode'] = 'pinned') => { clearTimeout(leave.current); setOpen({ id: cue.id, anchor, mode }); };
  const beginHold = (cue: SkillCue, anchor: HTMLElement, x: number, y: number) => {
    clearHold(); touch.current = true; press.current = { x, y };
    hold.current = setTimeout(() => show(cue, anchor), holdMs);
  };
  const move = (x: number, y: number) => { if (press.current && Math.hypot(x - press.current.x, y - press.current.y) > 8) clearHold(); };
  const leaveHover = () => { if (open?.mode === 'hover') leave.current = setTimeout(dismiss, 140); };

  useEffect(() => () => { clearTimeout(hold.current); clearTimeout(leave.current); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (event.target instanceof Node && !detail.current?.contains(event.target) && !open.anchor.contains(event.target)) dismiss(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    const scroll = (event: Event) => { if (!(event.target instanceof Node && detail.current?.contains(event.target))) dismiss(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('click', outside); document.addEventListener('keydown', key);
    window.addEventListener('resize', dismiss); window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('click', outside); document.removeEventListener('keydown', key);
      window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', scroll, true);
    };
  }, [open, dismiss]);
  useLayoutEffect(() => {
    if (!active || !open || !detail.current) return;
    const anchor = open.anchor.getBoundingClientRect(), rect = detail.current.getBoundingClientRect();
    const width = rect.width || Math.min(320, window.innerWidth - 24), height = rect.height || 260;
    const left = anchor.left - width - 12;
    setPosition({ left: Math.max(12, Math.min(left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(anchor.top, window.innerHeight - height - 100)) });
  }, [open, active]);

  const definition = active ? sourceDefinition(active, state) : undefined;
  const enhancement = active && !active.id.startsWith('skill:') ? active.id.split(':')[0] : undefined;
  const rule = enhancement ? SKILL_TEXT[enhancement] : definition ? getCardRuleText(definition) : '';
  return <section className="v2-skill-panel" aria-label="本次技能">
    <div className="v2-skill-heading"><h3>{children ? '技能 · 锦囊' : '本次技能'}</h3><span>{cues.filter(cue => cue.state === 'ready').length} 就绪</span></div>
    <div className="v2-skill-list">
      {!cues.length && <div className="v2-skill-empty" aria-label="空技能位"><span aria-hidden="true">◇</span></div>}
      {orderedCues(cues, state).map(cue => <article key={cue.id} data-skill-source={cue.sourceId} data-skill-id={cue.id} className={`v2-skill-cue v2-skill-${cue.state}${isCommandCue(cue, state) ? ' v2-skill-command-cue' : ''}`}>
        <button type="button" className="v2-skill-inspect" aria-label={`查看${cue.name}详情`} aria-haspopup="dialog" aria-expanded={active?.id === cue.id} aria-controls={active?.id === cue.id ? id : undefined}
          onPointerEnter={event => { if (event.pointerType !== 'touch') { touch.current = false; show(cue, event.currentTarget, 'hover'); } }}
          onPointerLeave={leaveHover}
          onFocus={event => { if (!touch.current) show(cue, event.currentTarget); }}
          onClick={event => show(cue, event.currentTarget)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); touch.current = false; show(cue, event.currentTarget); } }}
          onPointerDown={event => { if (event.pointerType === 'touch') beginHold(cue, event.currentTarget, event.clientX, event.clientY); else touch.current = false; }}
          onPointerMove={event => { if (event.pointerType === 'touch') move(event.clientX, event.clientY); }}
          onPointerUp={clearHold} onPointerCancel={clearHold}
          onTouchStart={event => { const first = event.touches[0]; if (event.touches.length === 1 && first) beginHold(cue, event.currentTarget, first.clientX, first.clientY); else clearHold(); }}
          onTouchMove={event => { const first = event.touches[0]; if (event.touches.length !== 1 || !first) clearHold(); else move(first.clientX, first.clientY); }}
          onTouchEnd={clearHold} onTouchCancel={clearHold} onContextMenu={event => event.preventDefault()}>
          <span className="v2-skill-emblem" aria-hidden="true">{cue.name.slice(0, 1)}</span>
          <span className="v2-skill-summary"><strong>{cue.name}</strong><small>{cue.sourceName}</small></span>
          <span className="v2-skill-status"><span className="v2-skill-state-icon" aria-hidden="true">{cue.state === 'waiting' ? <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v7H4z" /></svg> : MARKS[cue.state]}</span><span className="v2-skill-state-label">{STATES[cue.state]}</span></span>
        </button>
        <div className="v2-skill-actions">{cue.choice && cue.choice.options.length > 0 && cue.state !== 'used' && <>
          <button type="button" disabled={disabled} className={selecting === cue.id ? 'v2-targeting' : ''} aria-label={cue.choice.optional ? '发动弓腰姬，指定手牌兵器' : '指定连环目标'} onClick={() => { dismiss(); select(cue.choice!); }}><span className="v2-skill-action-icon" aria-hidden="true">⌖</span><span className="v2-skill-action-label">{selecting === cue.id ? '正在指定' : cue.choice.optional ? cue.targetIds.length ? '更换消耗牌' : '发动' : cue.targetIds.length ? '更换目标' : '指定目标'}</span></button>
          {cue.choice.optional && cue.targetIds.length > 0 && <button type="button" disabled={disabled} aria-label="取消发动弓腰姬" onClick={() => { dismiss(); cancelEffect(cue.choice!); }}><span className="v2-skill-action-icon" aria-hidden="true">×</span><span className="v2-skill-action-label">取消发动</span></button>}
        </>}</div>
      </article>)}
      {children}
    </div>
    {active && open && createPortal(<div ref={detail} id={id} role="dialog" aria-label={`${active.name}说明`} className={`v2-skill-detail v2-skill-detail-${active.state}`} style={{ position: 'fixed', left: position.left, top: position.top }} onPointerEnter={() => clearTimeout(leave.current)} onPointerLeave={leaveHover}>
      <header><div><small>{active.sourceName}{enhancement ? ' · 附加技能' : ' · 原技能'}</small><h3>{active.name}</h3></div><button type="button" aria-label="关闭技能详情" onClick={dismiss}>×</button></header>
      <strong className="v2-skill-detail-state">{STATES[active.state]}</strong>
      <p>{active.message}</p>
      {rule && <p className="v2-skill-rule">{rule}</p>}
      {active.choice && <p className="v2-skill-detail-note">{active.choice.optional ? '可不发动；指定后仍可取消，出战时才消耗。' : '请用技能栏的指定按钮，再点选高亮目标。'}</p>}
      <small className="v2-skill-detail-note">查看说明不会发动技能 · 点外部或 Esc 关闭</small>
    </div>, document.body)}
  </section>;
}
