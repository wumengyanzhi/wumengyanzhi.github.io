import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject, TouchEvent as ReactTouchEvent } from 'react';
import type { GameAction } from '../model';
import type { OperationSettings } from './operation-settings';
import { dropAction, dropKey, findDropTarget } from './drop-target';
import type { DragSource, DropTarget, Point } from './drop-target';

interface Session {
  source: DragSource; origin: Point; point: Point; rect: DOMRect; element: HTMLElement;
  touch: boolean; identifier: number; armed: boolean; active: boolean; target: DropTarget | null;
}
interface RowSwipe { element: HTMLElement; origin: Point; left: number; identifier: number; scrolling: boolean; }
export interface DragView { source: DragSource; point: Point; rect: DOMRect; touch: boolean; active: boolean; target: DropTarget | null; }
interface Options { root: RefObject<HTMLDivElement | null>; settings: OperationSettings; disabled: boolean; revision: number; commit: (action: GameAction) => void; }

/** Browser gestures remain UI state. Only a successful release sends one domain command. */
export function useCardGesture(options: Options) {
  const latest = useRef(options); latest.current = options;
  const session = useRef<Session | null>(null);
  const rowSwipe = useRef<RowSwipe | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const suppressed = useRef(false);
  const suppressedRelease = useRef<{ touch: boolean; identifier: number } | null>(null);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [view, setView] = useState<DragView | null>(null);

  const publish = () => {
    const current = session.current;
    if (!current) return;
    const root = latest.current.root.current;
    current.target = current.active && root ? findDropTarget(root, current.point, current.source, latest.current.settings.snapEnabled) : null;
    const snapshot = { ...current };
    setView(previous => ({ ...snapshot, target: dropKey(previous?.target ?? null) === dropKey(snapshot.target) ? previous?.target ?? null : snapshot.target }));
  };
  const clear = (render = true) => {
    const current = session.current;
    session.current = null;
    rowSwipe.current = null;
    clearTimeout(hold.current); hold.current = undefined;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    document.body.classList.remove('v2-is-dragging');
    if (current && !current.touch) {
      try { if (current.element.hasPointerCapture?.(current.identifier)) current.element.releasePointerCapture(current.identifier); } catch { /* Capture may already have been released by the browser. */ }
    }
    if (render) setView(null);
  };
  const blockClick = (current: Pick<Session, 'touch' | 'identifier'>) => {
    suppressed.current = true; clearTimeout(suppressTimer.current);
    suppressedRelease.current = { touch: current.touch, identifier: current.identifier };
  };
  const released = (touch: boolean, identifier: number) => {
    const waiting = suppressedRelease.current;
    if (!waiting || waiting.touch !== touch || waiting.identifier !== identifier) return;
    suppressedRelease.current = null;
    suppressTimer.current = setTimeout(() => { suppressed.current = false; }, 400);
  };
  const autoScroll = () => {
    const current = session.current, root = latest.current.root.current;
    if (!current?.active || !root) return;
    let changed = false;
    for (const row of root.querySelectorAll<HTMLElement>('[data-v2-card-row]')) {
      if (row.scrollWidth <= row.clientWidth) continue;
      const rect = row.getBoundingClientRect();
      if (current.point.y >= rect.top && current.point.y <= rect.bottom) {
        const dx = current.point.x < rect.left + 38 ? -9 : current.point.x > rect.right - 38 ? 9 : 0;
        if (dx) { const before = row.scrollLeft; row.scrollLeft += dx; changed ||= before !== row.scrollLeft; }
      }
    }
    const page = document.scrollingElement;
    if (page && page.scrollHeight > page.clientHeight) {
      const actionsTop = root.querySelector<HTMLElement>('.v2-battle-actions')?.getBoundingClientRect().top ?? window.innerHeight;
      const visibleBottom = Math.min(window.innerHeight, actionsTop);
      const dy = current.point.y < 45 ? -9 : current.point.y > visibleBottom - 35 ? 9 : 0;
      if (dy) { const before = page.scrollTop; page.scrollTop += dy; changed ||= before !== page.scrollTop; }
    }
    if (changed) publish();
    frame.current = requestAnimationFrame(autoScroll);
  };
  const activate = () => {
    const current = session.current;
    if (!current) return;
    rowSwipe.current = null;
    current.active = true; blockClick(current); document.body.classList.add('v2-is-dragging'); publish();
    frame.current = requestAnimationFrame(autoScroll);
  };
  const begin = (element: HTMLElement, source: DragSource, point: Point, touch: boolean, identifier: number) => {
    if (latest.current.disabled || !latest.current.settings.dragEnabled) return;
    clear(); suppressed.current = false; suppressedRelease.current = null; clearTimeout(suppressTimer.current);
    session.current = { source, origin: point, point, element, rect: element.getBoundingClientRect(), touch, identifier, armed: false, active: false, target: null };
    if (touch) { publish(); hold.current = setTimeout(() => { const current = session.current; if (current) { current.armed = true; blockClick(current); } }, latest.current.settings.touchHoldMs); }
    else { try { element.setPointerCapture?.(identifier); } catch { /* Window listeners remain the fallback. */ } }
  };
  const finish = (point: Point) => {
    const current = session.current;
    if (!current) return;
    current.point = point;
    if (!current.active) { clear(); return; }
    const root = latest.current.root.current;
    const target = root ? findDropTarget(root, point, current.source, latest.current.settings.snapEnabled) : null;
    const command = dropAction(current.source, target);
    blockClick(current); clear(); released(current.touch, current.identifier);
    if (command) latest.current.commit(command);
  };
  const cancel = () => { if (session.current?.active || session.current?.armed) blockClick(session.current); clear(); };

  // Stable listeners always consult refs, so pointer motion never uses an old game snapshot.
  const functions = useRef({ publish, activate, finish, cancel });
  functions.current = { publish, activate, finish, cancel };
  useEffect(() => {
    const pointerMove = (event: PointerEvent) => {
      const current = session.current;
      if (!current || current.touch || current.identifier !== event.pointerId) return;
      current.point = { x: event.clientX, y: event.clientY };
      const threshold = { responsive: 4, balanced: 8, steady: 12 }[latest.current.settings.dragSensitivity];
      if (!current.active && Math.hypot(current.point.x - current.origin.x, current.point.y - current.origin.y) >= threshold) functions.current.activate();
      else if (current.active) functions.current.publish();
      if (current.active && event.cancelable) event.preventDefault();
    };
    const pointerUp = (event: PointerEvent) => {
      if (!session.current?.touch && session.current?.identifier === event.pointerId) functions.current.finish({ x: event.clientX, y: event.clientY });
      released(false, event.pointerId);
    };
    const touchMove = (event: TouchEvent) => {
      const current = session.current;
      const swipe = rowSwipe.current;
      if (!current?.touch && !swipe) return;
      if (event.touches.length !== 1) { functions.current.cancel(); return; }
      const touch = [...event.touches].find(item => item.identifier === (swipe?.identifier ?? current?.identifier));
      if (!touch) return;
      if (current?.armed && !current.active && Math.hypot(touch.clientX - current.origin.x, touch.clientY - current.origin.y) > 8) {
        if (!event.cancelable) { functions.current.cancel(); return; }
        current.point = { x: touch.clientX, y: touch.clientY }; functions.current.activate();
      }
      if (swipe && !current?.active) {
        const dx = touch.clientX - swipe.origin.x, dy = touch.clientY - swipe.origin.y;
        if (swipe.scrolling || Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          if (!event.cancelable) { functions.current.cancel(); return; }
          event.preventDefault(); functions.current.cancel();
          swipe.scrolling = true; rowSwipe.current = swipe;
          blockClick({ touch: true, identifier: touch.identifier });
          swipe.element.scrollLeft = swipe.left - dx;
          return;
        }
        if (Math.hypot(dx, dy) > 10) {
          blockClick({ touch: true, identifier: touch.identifier }); functions.current.cancel();
          // A small diagonal move cancels holding, while its eventual scroll axis
          // stays undecided until one component crosses the same threshold.
          if (Math.abs(dy) <= 10) rowSwipe.current = swipe;
        }
        return;
      }
      if (!current) return;
      current.point = { x: touch.clientX, y: touch.clientY };
      if (!current.active) {
        if (Math.hypot(current.point.x - current.origin.x, current.point.y - current.origin.y) > 10) { blockClick(current); functions.current.cancel(); }
        return;
      }
      if (!event.cancelable) { functions.current.cancel(); return; }
      event.preventDefault();
      functions.current.publish();
    };
    const touchEnd = (event: TouchEvent) => {
      const current = session.current;
      if (current?.touch) {
        const touch = [...event.changedTouches].find(item => item.identifier === current.identifier);
        if (touch) functions.current.finish({ x: touch.clientX, y: touch.clientY });
      }
      if (rowSwipe.current && [...event.changedTouches].some(touch => touch.identifier === rowSwipe.current?.identifier)) rowSwipe.current = null;
      for (const touch of event.changedTouches) released(true, touch.identifier);
    };
    const touchStart = (event: TouchEvent) => { if (event.touches.length > 1) functions.current.cancel(); };
    const cancelled = () => functions.current.cancel();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') functions.current.cancel(); };
    const hidden = () => { if (document.hidden) functions.current.cancel(); };
    window.addEventListener('pointermove', pointerMove, { passive: false }); window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', cancelled); window.addEventListener('touchmove', touchMove, { passive: false });
    // Register before a gesture starts; vertical swipes keep native page scrolling.
    window.addEventListener('touchend', touchEnd); window.addEventListener('touchcancel', cancelled); window.addEventListener('touchstart', touchStart, { passive: false });
    window.addEventListener('blur', cancelled); window.addEventListener('pagehide', cancelled);
    document.addEventListener('keydown', escape); document.addEventListener('visibilitychange', hidden);
    return () => {
      clear(false); clearTimeout(suppressTimer.current);
      window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('touchmove', touchMove); window.removeEventListener('touchend', touchEnd); window.removeEventListener('touchcancel', cancelled); window.removeEventListener('touchstart', touchStart);
      window.removeEventListener('blur', cancelled); window.removeEventListener('pagehide', cancelled);
      document.removeEventListener('keydown', escape); document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => { functions.current.cancel(); }, [options.revision, options.disabled, options.settings.dragEnabled]);
  return {
    view,
    beginRowSwipe(event: ReactTouchEvent<HTMLDivElement>) {
      const touch = event.touches[0];
      if (!latest.current.settings.dragEnabled || event.touches.length !== 1 || !touch) return;
      rowSwipe.current = { element: event.currentTarget, origin: { x: touch.clientX, y: touch.clientY }, left: event.currentTarget.scrollLeft, identifier: touch.identifier, scrolling: false };
    },
    startClick() {
      // A new press may be the first event received after returning to the window.
      if (!session.current) { suppressed.current = false; suppressedRelease.current = null; clearTimeout(suppressTimer.current); }
    },
    bind(source: DragSource) {
      return {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => { if (event.pointerType !== 'touch' && event.button === 0 && event.isPrimary !== false) begin(event.currentTarget, source, { x: event.clientX, y: event.clientY }, false, event.pointerId); },
        onTouchStart: (event: ReactTouchEvent<HTMLElement>) => { const touch = event.touches[0]; if (event.touches.length === 1 && touch) begin(event.currentTarget, source, { x: touch.clientX, y: touch.clientY }, true, touch.identifier); },
        onContextMenu: (event: ReactMouseEvent<HTMLElement>) => { if (session.current?.touch) event.preventDefault(); },
        onLostPointerCapture: () => { if (session.current?.active && !session.current.touch) cancel(); },
      };
    },
    cancelClick(event: ReactMouseEvent<HTMLElement>) { if (suppressed.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } },
    cancel,
  };
}
