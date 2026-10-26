import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './tutorial-coachmark.css';

export interface TutorialCoachmarkProps {
  step: string; title: string; text: string; selectors: string[]; progress: string;
  allowSelectors?: string[]; drag?: boolean; onNext?: () => void; nextLabel?: string;
  onExit: () => void; onSkip: () => void;
}

interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }
interface Highlight extends Box { kind: 'target' | 'dialog' }
interface Geometry { width: number; height: number; holes: Highlight[]; left: number; top: number; bubbleWidth: number; bubbleMaxHeight: number; missing: boolean; compactDialog: boolean }
const FOCUSABLE = 'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

function query(selectors: string[]): HTMLElement[] {
  return [...new Set(selectors.flatMap(selector => {
    try { return Array.from(document.querySelectorAll<HTMLElement>(selector)); } catch { return []; }
  }))];
}
function displayed(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}
function visibleBox(element: HTMLElement, width: number, height: number): Box | null {
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left); let right = Math.min(width, rect.right);
  let top = Math.max(0, rect.top); let bottom = Math.min(height, rect.bottom);
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent); const clip = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX || style.overflow)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY || style.overflow)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
  }
  return right > left && bottom > top ? { left, right, top, bottom, width: right - left, height: bottom - top } : null;
}
function dialogs(): HTMLElement[] { return query(['[role="dialog"]', 'dialog[open]']).filter(displayed); }
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

function revealDragRow(targets: HTMLElement[], width: number): void {
  if (targets.length < 2) return;
  for (let row = targets[0]!.parentElement; row && row !== document.body; row = row.parentElement) {
    if (!targets.every(target => row!.contains(target))) continue;
    const style = getComputedStyle(row);
    if (!/(auto|scroll)/.test(style.overflowX || style.overflow) || row.scrollWidth <= row.clientWidth) continue;
    const rowBox = row.getBoundingClientRect();
    const left = Math.max(0, rowBox.left); const right = Math.min(width, rowBox.right);
    const boxes = targets.map(target => target.getBoundingClientRect());
    const start = Math.min(...boxes.map(box => box.left)); const end = Math.max(...boxes.map(box => box.right));
    if (end - start <= right - left + 1) {
      const delta = start < left ? start - left : end > right ? end - right : 0;
      const next = clamp(row.scrollLeft + delta, 0, row.scrollWidth - row.clientWidth);
      row.scrollLeft = next < 4 ? 0 : next;
    }
    break;
  }
}

function revealAboveActions(target: HTMLElement): void {
  if (target.closest('.v2-battle-actions')) return;
  const actions = query(['.v2-battle-actions']).find(element => displayed(element) && ['sticky', 'fixed'].includes(getComputedStyle(element).position));
  if (!actions) return;
  const footer = actions.getBoundingClientRect(); const card = target.getBoundingClientRect();
  if (card.left >= footer.right || card.right <= footer.left || card.top >= footer.bottom || footer.top >= window.innerHeight) return;
  const delta = Math.min(card.bottom - footer.top + 12, card.top - 12);
  if (delta > 0) window.scrollBy?.({ top: delta, behavior: 'instant' });
}

/** A portal keeps the spotlight independent of the battle's scrolling and stacking contexts. */
export function TutorialCoachmark({ step, title, text, selectors, progress, allowSelectors = [], drag = false, onNext, nextLabel = '知道了', onExit, onSkip }: TutorialCoachmarkProps) {
  const bubble = useRef<HTMLElement | null>(null);
  const maskId = `coachmark-${useId().replace(/:/g, '')}`;
  const [geometry, setGeometry] = useState<Geometry>({ width: window.innerWidth, height: window.innerHeight, holes: [], left: 8, top: 8, bubbleWidth: Math.min(340, window.innerWidth - 16), bubbleMaxHeight: window.innerHeight - 16, missing: true, compactDialog: false });
  const selectorKey = JSON.stringify(selectors); const allowKey = JSON.stringify(allowSelectors);

  useLayoutEffect(() => {
    const targetSelectors = JSON.parse(selectorKey) as string[];
    const extraSelectors = JSON.parse(allowKey) as string[];
    const originalFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let stopped = false;
    let revealed = false;
    const roots = () => {
      const realDialogs = dialogs();
      return [...(realDialogs.length ? realDialogs : query(targetSelectors)), ...query(extraSelectors), ...query(['.v2-card-tooltip']), ...(bubble.current ? [bubble.current] : [])];
    };
    const allowed = (target: EventTarget | null) => target instanceof Node && roots().some(root => root === target || root.contains(target));
    const focusables = () => [...new Set(roots().flatMap(root => [ ...(root.matches(FOCUSABLE) ? [root] : []), ...root.querySelectorAll<HTMLElement>(FOCUSABLE) ]))].filter(displayed);
    const focusSafe = () => (focusables()[0] ?? bubble.current)?.focus({ preventScroll: true });
    const block = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const guard = (event: Event) => { if (!allowed(event.target)) block(event); };
    const focusGuard = (event: Event) => { if (!allowed(event.target)) { event.stopImmediatePropagation(); focusSafe(); } };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const items = focusables(); const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
        block(event); (items[next] ?? bubble.current)?.focus({ preventScroll: true });
      } else if (!allowed(event.target)) {
        // Keep native page navigation available while rejecting game shortcuts.
        if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.stopImmediatePropagation();
        else block(event);
      }
    };
    const update = () => {
      if (stopped) return;
      const width = window.innerWidth; const height = window.innerHeight;
      const realDialogs = dialogs();
      const targets = (realDialogs.length ? realDialogs : query(targetSelectors)).filter(displayed);
      if (!revealed && targets.length) {
        revealed = true;
        // A long reward list may already have useful choices on screen.
        const first = (!drag && targets.find(target => visibleBox(target, width, height))) || targets[0]!;
        const box = visibleBox(first, width, height); const initial = first.getBoundingClientRect();
        if (!box || box.width < initial.width || box.height < initial.height) first.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        // Previous single-card lessons may leave this row panned away from the
        // destination. Reveal the source/destination union when it fits intact.
        if (drag && !realDialogs.length) revealDragRow(targets, width);
        if (!realDialogs.length) revealAboveActions(first);
        const rect = first.getBoundingClientRect();
        if (width <= 640 && rect.top < 220 && height - rect.bottom < 220 && window.scrollY > 0) window.scrollBy?.({ top: rect.top - 24, behavior: 'instant' });
      }
      const holes: Highlight[] = targets.flatMap(target => {
        const box = visibleBox(target, width, height);
        return box ? [{ ...box, kind: realDialogs.length ? 'dialog' as const : 'target' as const }] : [];
      });
      const anchor = holes[0]; const bubbleWidth = Math.min(340, width - 16);
      const bubbleHeight = Math.min(bubble.current?.getBoundingClientRect().height || 200, height - 16);
      let left = (width - bubbleWidth) / 2; let top = (height - bubbleHeight) / 2; let bubbleMaxHeight = height - 16;
      let compactDialog = false;
      if (anchor) {
        // Multiple reward cards can form a long list: anchor to the first visible card.
        const bounds = drag && holes.length > 1 ? { left: Math.min(...holes.map(h => h.left)), right: Math.max(...holes.map(h => h.right)), top: Math.min(...holes.map(h => h.top)), bottom: Math.max(...holes.map(h => h.bottom)) } : anchor;
        if (width > 640 && width - bounds.right >= bubbleWidth + 24) { left = bounds.right + 16; top = bounds.top; }
        else if (width > 640 && bounds.left >= bubbleWidth + 24) { left = bounds.left - bubbleWidth - 16; top = bounds.top; }
        else {
          left = bounds.left + (bounds.right - bounds.left - bubbleWidth) / 2;
          const below = height - bounds.bottom - 20; const above = bounds.top - 20;
          if (below >= bubbleHeight || below >= above) { top = bounds.bottom + 12; bubbleMaxHeight = Math.max(48, below); }
          else { bubbleMaxHeight = Math.max(48, above); top = bounds.top - Math.min(bubbleHeight, bubbleMaxHeight) - 12; }
        }
      }
      if (realDialogs.length && bubbleMaxHeight < 120) {
        // A full-height details dialog has no outside space. Keep a compact,
        // readable panel at the opposite edge from its real close control.
        compactDialog = true;
        bubbleMaxHeight = Math.min(240, height - 16);
        const close = Array.from(realDialogs.at(-1)!.querySelectorAll<HTMLElement>('button,[aria-label]')).find(element => /关闭|close/i.test(`${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`));
        const closeBox = close?.getBoundingClientRect();
        const readableHeight = Math.min(bubbleMaxHeight, Math.max(180, bubbleHeight));
        top = closeBox && closeBox.top > height / 2 ? 8 : height - readableHeight - 8;
        left = (width - bubbleWidth) / 2;
      }
      // Tooltips are portals too; cut out their actual bounds so card text remains readable.
      const tooltipHoles: Highlight[] = query(['.v2-card-tooltip']).filter(displayed).flatMap(tooltip => {
        const box = visibleBox(tooltip, width, height);
        return box ? [{ ...box, kind: 'target' as const }] : [];
      });
      const next: Geometry = { width, height, holes: [...holes, ...tooltipHoles], left: clamp(left, 8, width - bubbleWidth - 8), top: clamp(top, 8, height - Math.min(bubbleHeight, bubbleMaxHeight) - 8), bubbleWidth, bubbleMaxHeight, missing: !targets.length, compactDialog };
      setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    // Reveal the first target (or a drag pair) once per lesson. Scroll listeners only measure,
    // so swiping a row or scrolling the page never starts an auto-scroll loop.
    update();
    const guardedEvents = ['click', 'pointerdown', 'touchstart', 'dblclick', 'contextmenu'];
    guardedEvents.forEach(type => document.addEventListener(type, guard, { capture: true, passive: false }));
    // Never guard move/up/cancel: captured pointer gestures must finish naturally.
    document.addEventListener('keydown', keyboard, true); document.addEventListener('focusin', focusGuard, true);
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element) || !record.target.closest('.v2-coachmark'))) update();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    [bubble.current, ...query(targetSelectors)].forEach(element => { if (element) resizeObserver?.observe(element); });
    return () => {
      stopped = true; observer.disconnect(); resizeObserver?.disconnect();
      guardedEvents.forEach(type => document.removeEventListener(type, guard, true));
      document.removeEventListener('keydown', keyboard, true); document.removeEventListener('focusin', focusGuard, true);
      window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true);
      if (originalFocus?.isConnected) originalFocus.focus({ preventScroll: true });
    };
  }, [step, selectorKey, allowKey, drag]);

  const source = geometry.holes[0]; const destination = geometry.holes[1];
  return createPortal(<div className="v2-coachmark" data-coachmark-step={step}>
    <svg className="v2-coachmark-spotlight" width={geometry.width} height={geometry.height} aria-hidden="true">
      <defs><mask id={maskId}><rect width="100%" height="100%" fill="white" />{geometry.holes.map((hole, index) => <rect key={index} x={hole.left - 4} y={hole.top - 4} width={hole.width + 8} height={hole.height + 8} rx="7" fill="black" />)}</mask></defs>
      <rect width="100%" height="100%" fill="#070906" opacity=".77" mask={`url(#${maskId})`} />
      {geometry.holes.map((hole, index) => <rect key={index} data-coachmark-outline={hole.kind} x={hole.left - 4} y={hole.top - 4} width={hole.width + 8} height={hole.height + 8} rx="7" fill="none" stroke="#f6cf7b" strokeWidth="2" />)}
      {drag && source && destination && <g className="v2-coachmark-drag"><path d={`M ${source.left + source.width / 2} ${source.top + source.height / 2} Q ${(source.left + destination.left) / 2} ${Math.min(source.top, destination.top) - 24} ${destination.left + destination.width / 2} ${destination.top + destination.height / 2}`} fill="none" stroke="#ffe2a0" strokeWidth="3" strokeDasharray="7 6" /><text x={destination.left + destination.width / 2} y={destination.top + destination.height / 2} textAnchor="middle" fill="#ffe2a0" fontSize="27">↓</text><text x={source.left + source.width / 2} y={source.top + source.height / 2} textAnchor="middle" fontSize="27">☝</text></g>}
    </svg>
    <section ref={bubble} className={`v2-coachmark-bubble${geometry.compactDialog ? ' v2-coachmark-dialog-note' : ''}`} role="region" aria-label="教学提示" tabIndex={-1} style={{ left: geometry.left, top: geometry.top, width: geometry.bubbleWidth, maxHeight: geometry.bubbleMaxHeight }}>
      <p className="v2-coachmark-progress">新手演武 · {progress}</p><h2>{title}</h2><p className="v2-coachmark-copy" aria-live="polite">{text}</p>
      {geometry.missing && <p className="v2-coachmark-locating" role="status">正在定位操作目标。可稍候，或退出后继续演武。</p>}
      {drag && <p className="v2-coachmark-drag-tip">按住金框内的牌，拖到箭头所指格位；也可用键盘移动。</p>}
      <div className="v2-coachmark-actions"><button onClick={onExit}>退出演武</button><button onClick={onSkip}>跳过教学</button>{onNext && <button className="v2-coachmark-next" onClick={onNext}>{nextLabel}</button>}</div>
    </section>
  </div>, document.body);
}
