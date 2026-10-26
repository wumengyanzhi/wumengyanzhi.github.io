import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode, TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { CARD_MAP } from '../data';
import type { CardDef, CardInstance } from '../model';
import { CardTypeIcon, FACTIONS, PROFESSIONS, RARITIES, SKILL_NAMES, SKILL_TEXT, TYPES, WEAPONS } from './primitives';
import { AUTOMATIC_EQUIPMENT_TEXT, getCardRuleText } from './card-copy';

interface Inspection { face: HTMLElement; definition: CardDef; instanceId?: string; mode: 'mouse' | 'touch' | 'keyboard'; }
interface Press { face: HTMLElement; identifier: number; x: number; y: number; held: boolean; }
const faceAt = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('.v2-card-face[data-card-definition]') ?? target.closest('button, [tabindex]')?.querySelector<HTMLElement>('.v2-card-face[data-card-definition]') ?? null : null;
const inInfo = (target: EventTarget | null) => target instanceof Element && !!target.closest('.v2-card-tooltip');

/** One inspection layer for cards in battle, the codex, rewards and modal lists. */
export function CardInspector({ children, cards, holdMs, contextKey, onInspect, disabled = false }: { children: ReactNode; cards?: Record<string, CardInstance>; holdMs: number; contextKey: string; onInspect?: (definitionId: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState<Inspection | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pendingFace = useRef<HTMLElement | null>(null);
  const press = useRef<Press | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const keyboard = useRef(false);
  const id = useId();
  const clearTimers = useCallback(() => { clearTimeout(timer.current); clearTimeout(leaveTimer.current); timer.current = undefined; leaveTimer.current = undefined; }, []);
  const dismiss = useCallback(() => { clearTimers(); pendingFace.current = null; press.current = null; setOpen(null); setPosition(null); }, [clearTimers]);
  const show = (face: HTMLElement, mode: Inspection['mode']) => {
    const definition = CARD_MAP[face.dataset.cardDefinition ?? ''];
    if (disabled || !definition || !face.isConnected || face.closest('[aria-hidden="true"]') || document.body.classList.contains('v2-is-dragging')) return;
    pendingFace.current = face; setPosition(null);
    setOpen({ face, definition, instanceId: face.dataset.cardInstance, mode });
    onInspect?.(definition.id);
  };
  const scheduleLeave = () => { clearTimeout(leaveTimer.current); leaveTimer.current = setTimeout(dismiss, 140); };
  useEffect(() => { dismiss(); }, [contextKey, holdMs, disabled, dismiss]);
  useEffect(() => {
    const scroll = (event: Event) => { if (!inInfo(event.target)) dismiss(); };
    const cancelled = (event: Event) => { if (!inInfo(event.target)) dismiss(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    const hidden = () => { if (document.hidden) dismiss(); };
    window.addEventListener('scroll', scroll, true); window.addEventListener('resize', dismiss); window.addEventListener('blur', dismiss);
    window.addEventListener('touchcancel', cancelled); window.addEventListener('pointercancel', cancelled);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('keydown', escape);
    return () => {
      clearTimers(); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss);
      window.removeEventListener('touchcancel', cancelled); window.removeEventListener('pointercancel', cancelled); document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('keydown', escape);
    };
  }, [dismiss, clearTimers]);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const rect = panel.current.getBoundingClientRect(), anchor = open.face.getBoundingClientRect();
    const width = rect.width || 320, height = rect.height || 220, gap = 12;
    let left = anchor.right + gap;
    if (left + width > window.innerWidth - gap) left = anchor.left - width - gap;
    if (open.mode === 'touch') left = (window.innerWidth - width) / 2;
    const top = open.mode === 'touch' ? (window.innerHeight - height) / 2 : anchor.top;
    setPosition({ left: Math.max(gap, Math.min(left, window.innerWidth - width - gap)), top: Math.max(gap, Math.min(top, window.innerHeight - height - gap)) });
    const trigger = open.face.closest('button, [tabindex]') ?? open.face;
    const previous = trigger.getAttribute('aria-describedby');
    trigger.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '));
    return () => { if (previous === null) trigger.removeAttribute('aria-describedby'); else trigger.setAttribute('aria-describedby', previous); };
  }, [open, id]);
  const pointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || event.buttons || inInfo(event.target)) return;
    const face = faceAt(event.target);
    if (!face || face.closest('.v2-drag-ghost')) return;
    clearTimeout(leaveTimer.current);
    if (pendingFace.current === face) return;
    dismiss(); pendingFace.current = face;
    timer.current = setTimeout(() => show(face, 'mouse'), 1500);
  };
  const touchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (inInfo(event.target)) return;
    dismiss(); const touch = event.touches[0], face = faceAt(event.target);
    if (event.touches.length !== 1 || !touch || !face) return;
    press.current = { face, identifier: touch.identifier, x: touch.clientX, y: touch.clientY, held: false };
    timer.current = setTimeout(() => {
      const current = press.current;
      if (!current) return;
      current.held = true; suppressClick.current = true; show(current.face, 'touch');
    }, holdMs);
  };
  const touchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const current = press.current;
    if (!current) return;
    const touch = Array.from(event.touches).find(item => item.identifier === current.identifier);
    if (event.touches.length !== 1 || !touch || Math.hypot(touch.clientX - current.x, touch.clientY - current.y) > 8) dismiss();
  };
  const touchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (press.current?.held && event.cancelable) event.preventDefault();
    clearTimeout(timer.current); press.current = null;
  };
  const definition = open?.definition, instance = open?.instanceId ? cards?.[open.instanceId] : undefined;
  const rule = definition ? getCardRuleText(definition) : '';
  const power = definition ? definition.power + (instance?.permanentPower ?? 0) + (instance?.temporaryPower ?? 0) : 0;
  const amp = definition ? definition.amp + (instance?.permanentAmp ?? 0) + (instance?.temporaryAmp ?? 0) : 0;
  return <div className="v2-inspector-root"
    onPointerOver={pointerOver}
    onPointerOut={event => {
      if (event.pointerType === 'touch' || open?.mode === 'touch' || inInfo(event.relatedTarget)) return;
      const face = pendingFace.current;
      if (face && !(event.relatedTarget instanceof Node && face.contains(event.relatedTarget))) {
        clearTimeout(timer.current);
        if (open) scheduleLeave(); else pendingFace.current = null;
      }
    }}
    onPointerDownCapture={event => { if (!inInfo(event.target)) { keyboard.current = false; suppressClick.current = event.pointerType === 'touch' && open?.mode === 'touch'; dismiss(); } }}
    onDragStartCapture={dismiss}
    onTouchStartCapture={touchStart} onTouchMoveCapture={touchMove} onTouchEndCapture={touchEnd}
    onClickCapture={event => {
      if (inInfo(event.target)) return;
      if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
      else dismiss();
    }}
    onKeyDownCapture={event => { if (event.key === 'Tab') keyboard.current = true; if (event.key === 'Escape') dismiss(); }}
    onFocusCapture={event => { const face = faceAt(event.target); if (keyboard.current && face) { clearTimers(); show(face, 'keyboard'); } }}
    onBlurCapture={() => { if (open?.mode === 'keyboard') dismiss(); }}
  >{children}{open && definition && createPortal(<div ref={panel} id={id} role="tooltip" className={`v2-card-tooltip v2-type-${definition.type} v2-rarity-${definition.rarity}`} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
    onPointerEnter={() => clearTimeout(leaveTimer.current)} onPointerLeave={() => { if (open.mode !== 'touch') scheduleLeave(); }}>
    <div className="v2-inspect-meta"><span><CardTypeIcon type={definition.type} />{TYPES[definition.type]}</span><span className="v2-inspect-rarity">{RARITIES[definition.rarity]}</span></div>
    <h3>{definition.name}</h3>
    <p className="v2-inspect-subtype">{[definition.faction ? FACTIONS[definition.faction] : null, definition.profession ? PROFESSIONS[definition.profession] : null, definition.weaponClass ? WEAPONS[definition.weaponClass] : null, definition.type === 'tactic' ? '运筹之策' : null].filter(Boolean).join(' · ')}</p>
    <div className="v2-inspect-stats"><span>当前威力 <b>{power}</b></span><span>当前增幅 <b>{amp}</b></span></div>
    {rule && <p className="v2-inspect-rule">{rule}</p>}
    {definition.type === 'weapon' && <p className="v2-inspect-note">{AUTOMATIC_EQUIPMENT_TEXT}</p>}
    {instance && <div className="v2-inspect-growth"><span>永久强化：威力 +{instance.permanentPower} · 增幅 +{instance.permanentAmp}</span><span>本场临时：威力 +{instance.temporaryPower} · 增幅 +{instance.temporaryAmp}</span>{instance.enhancementSkills.map(skill => <p key={skill}>{SKILL_NAMES[skill]}：{SKILL_TEXT[skill]}</p>)}{instance.chain && <p>连环：本场下次成功出战时，原技能额外结算一次后移除；战后清除。</p>}</div>}
    <small>{open.mode === 'touch' ? '轻点外部关闭' : '移开收起 · Esc 关闭'}</small>
  </div>, document.body)}</div>;
}
