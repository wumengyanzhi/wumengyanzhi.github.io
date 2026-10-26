import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { InstanceId } from '@domain/models/ids';
import {
  followDelta,
  grabOffset,
  passedThreshold,
  resolveDrop,
  type DragSession,
  type DropZone,
  type DragSource,
  type Point,
  type Rect,
} from './snap';

/**
 * 拖拽上下文。
 *
 * 只管「手上有张牌正在飞」，不参与任何规则判断：合法性由使用方给的 isLegalTarget 决定，
 * 落点对应的命令由使用方给的 onDrop 决定。这一层不知道 StageCard 存在，更不会自己去发命令。
 *
 * 之所以用全局鼠标监听而不是 HTML5 拖放：拖放 API 在桌面浏览器上的拖拽影像不可控，
 * 而且 Safari 的 dragover 时序很难写出稳定的吸附。这里只是跟随一块 DOM，顺手很多。
 */

const DEFAULT_ZONE_SELECTOR = '[data-drop-zone]';
const REBOUND_MS = 260;

export interface DropTargetQuery {
  readonly session: DragSession;
  readonly zone: DropZone;
}

export interface ReboundMark {
  readonly instanceId: InstanceId;
  readonly token: number;
}

export interface DragContextValue {
  readonly enabled: boolean;
  readonly session: DragSession | null;
  readonly rebound: ReboundMark | null;
  /** 被拖卡面相对原位的位移，用于 transform。 */
  readonly delta: Point;
  begin(instanceId: InstanceId, source: DragSource, element: Element | null, origin: Point): void;
}

const DragContext = createContext<DragContextValue | null>(null);

export function useDrag(): DragContextValue {
  const value = useContext(DragContext);
  if (value === null) throw new Error('拖拽上下文缺失：组件必须放在 DragProvider 内');
  return value;
}

/** 掉落区自己用的高亮状态。空中的牌还没选中任何区时会返回空串。 */
export function useDropHighlight(kind: DropZone['kind'], index: number): string {
  const { session } = useDrag();
  const hovered = session?.hoverZone;
  if (hovered === null || hovered === undefined) return '';
  if (hovered.kind !== kind || hovered.index !== index) return '';
  return session?.hoverLegal === true ? 'zone--target' : 'zone--blocked';
}

export interface DragProviderProps {
  readonly children: ReactNode;
  readonly enabled?: boolean;
  /** 掉落区选择器；默认认所有带 data-drop-zone 的元素。 */
  readonly zoneSelector?: string;
  /** 量矩形的口子：默认是读 getBoundingClientRect，测试里可以换成固定坐标系。 */
  readonly measure?: (element: Element) => Rect | null;
  /** 这个落点是否被允许；不传则所有掉落区都算合法。 */
  readonly isLegalTarget?: (query: DropTargetQuery) => boolean;
  readonly onDrop: (session: DragSession, target: ReturnType<typeof resolveDrop>) => void;
}

function defaultMeasure(element: Element): Rect | null {
  if (typeof (element as { getBoundingClientRect?: unknown }).getBoundingClientRect !== 'function') return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function readZone(element: Element, measure: (element: Element) => Rect | null): DropZone | null {
  const kind = element.getAttribute('data-drop-zone');
  if (kind !== 'slot' && kind !== 'hand') return null;
  const rect = measure(element);
  if (rect === null) return null;
  const rawIndex = Number(element.getAttribute('data-drop-index') ?? '0');
  return { kind, index: Number.isFinite(rawIndex) ? rawIndex : 0, rect };
}

export function DragProvider({
  children,
  enabled = true,
  zoneSelector = DEFAULT_ZONE_SELECTOR,
  measure = defaultMeasure,
  isLegalTarget,
  onDrop,
}: DragProviderProps): ReactElement {
  const [session, setSession] = useState<DragSession | null>(null);
  const [rebound, setRebound] = useState<ReboundMark | null>(null);
  const [delta, setDelta] = useState<Point>({ x: 0, y: 0 });

  const latest = useRef({ isLegalTarget, onDrop, measure });
  latest.current = { isLegalTarget, onDrop, measure };

  const geometry = useRef<{ rect: Rect; offset: Point } | null>(null);
  const activeRef = useRef(false);
  const suppressClick = useRef(false);
  const reboundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 会话的权威副本放在 ref 里：全局鼠标监听要在最新快照上工作，
  // 而落下时要派命令，副作用绝对不能写在 setState 的更新函数里（严格模式会跑两遍）。
  const sessionRef = useRef<DragSession | null>(null);

  const collectZones = useCallback((): readonly DropZone[] => {
    const nodes = document.querySelectorAll(zoneSelector);
    const zones: DropZone[] = [];
    for (const node of nodes) {
      const zone = readZone(node, latest.current.measure);
      if (zone !== null) zones.push(zone);
    }
    return zones;
  }, [zoneSelector]);

  const finish = useCallback((point: Point): void => {
    const ongoing = sessionRef.current;
    sessionRef.current = null;
    activeRef.current = false;
    geometry.current = null;
    setSession(null);
    setDelta({ x: 0, y: 0 });
    suppressClick.current = true;
    if (ongoing === null) return;

    const { isLegalTarget: legal, onDrop: drop } = latest.current;
    const target = resolveDrop(collectZones(), point);
    const accepted = target !== null && (legal === undefined || legal({ session: ongoing, zone: target.zone }));
    if (target !== null && accepted) {
      drop(ongoing, target);
      return;
    }
    // 没落在任何合法区：既不发命令，也要让玩家看见牌「弹回去」了。
    drop(ongoing, null);
    setRebound((mark) => ({ instanceId: ongoing.instanceId, token: (mark?.token ?? 0) + 1 }));
    if (reboundTimer.current !== null) clearTimeout(reboundTimer.current);
    reboundTimer.current = setTimeout(() => setRebound(null), REBOUND_MS);
  }, [collectZones]);

  const begin = useCallback((instanceId: InstanceId, source: DragSource, element: Element | null, origin: Point): void => {
    if (!enabled) return;
    const rect = element === null ? null : latest.current.measure(element);
    const base: Rect = rect ?? { x: origin.x, y: origin.y, width: 0, height: 0 };
    const held = { rect: base, offset: grabOffset(base, origin) };
    geometry.current = held;
    activeRef.current = false;
    const created: DragSession = {
      instanceId,
      source,
      origin,
      current: origin,
      offset: held.offset,
      active: false,
      hoverZone: null,
      hoverLegal: false,
    };
    sessionRef.current = created;
    setSession(created);
  }, [enabled]);

  // 只在「有没有会话」变化时重装监听：鼠标每动一次都会更新会话，但监听器不需要跟着拆装。
  const sessionStarted = session !== null;
  useEffect(() => {
    if (!sessionStarted) return undefined;

    function onMove(event: MouseEvent): void {
      const held = geometry.current;
      const ongoing = sessionRef.current;
      if (held === null || ongoing === null) return;
      const point = { x: event.clientX, y: event.clientY };
      if (!activeRef.current && !passedThreshold(ongoing.origin, point)) return;
      activeRef.current = true;

      const zones = collectZones();
      const target = resolveDrop(zones, point);
      const draft: DragSession = { ...ongoing, current: point, active: true, hoverZone: target?.zone ?? null, hoverLegal: false };
      const legal = latest.current.isLegalTarget;
      const next: DragSession = target === null || legal === undefined
        ? { ...draft, hoverLegal: false }
        : { ...draft, hoverLegal: legal({ session: draft, zone: target.zone }) };
      sessionRef.current = next;
      setSession(next);
      setDelta(followDelta(held.rect, point, held.offset));
    }

    function onUp(event: MouseEvent): void {
      finish({ x: event.clientX, y: event.clientY });
    }

    function onCancel(): void {
      sessionRef.current = null;
      activeRef.current = false;
      geometry.current = null;
      setSession(null);
      setDelta({ x: 0, y: 0 });
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel();
    }

    // 拖完落在别处时浏览器仍会补一个 click，若不掐掉会顺手选中/收回刚放好的牌。
    function onClickCapture(event: MouseEvent): void {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClickCapture, true);
    const release = setTimeout(() => { suppressClick.current = false; }, 0);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClickCapture, true);
      clearTimeout(release);
    };
  }, [sessionStarted, collectZones, finish]);

  useEffect(() => () => {
    if (reboundTimer.current !== null) clearTimeout(reboundTimer.current);
  }, []);

  /*
   * 牌被拿起来时给根元素打标记，样式层据此解除手牌带与出牌框的 overflow: hidden。
   * 不这么做，飞出去的那张牌会在带子边界被裁掉——玩家看到的是「牌压在空位下面」。
   * 只在真正越过阈值后才打标记：单纯按一下不该动任何裁剪行为。
   */
  const lifted = session?.active === true;
  useEffect(() => {
    const root = document.documentElement;
    if (!lifted) return undefined;
    root.setAttribute('data-dragging', 'true');
    return () => {
      root.removeAttribute('data-dragging');
    };
  }, [lifted]);

  const value = useMemo<DragContextValue>(
    () => ({ enabled, session, rebound, delta, begin }),
    [enabled, session, rebound, delta, begin],
  );

  return <DragContext.Provider value={value}>{children}</DragContext.Provider>;
}
