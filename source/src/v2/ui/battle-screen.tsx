import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, RunState } from '../model';
import { CARD_MAP } from '../data';
import { enemiesFor } from '../campaign';
import { CampaignProgress } from './campaign-progress';
import { getBattleChoices, getEquipment, previewBattle } from '../battle';
import { CardFace, CardLegend, Modal } from './primitives';
import { CardArt } from './card-art';
import { act } from '../engine';
import { useCardGesture } from './card-gesture';
import { dropAction } from './drop-target';
import { DEFAULT_OPERATIONS } from './operation-settings';
import type { OperationSettings } from './operation-settings';
import './card-gesture.css';
import { battleSkillCues, pairingHint } from './battle-guidance';
import { SkillPanel } from './skill-panel';
import { PlayResult } from './play-result';
import { BattleHud, BattleIcon } from './battle-hud';
import { BattleForecast } from './battle-forecast';
import { BattleCharms } from './battle-charms';
import { BossIntel } from './boss-intel';
import { BattleOverview } from './battle-overview';
import './battle-guidance.css';
import { reconcileHandAnchors, reorderHandAnchors } from './hand-anchors';
import type { HandAnchors } from './hand-anchors';

interface Teaching {
  health: number; canPlay: boolean; canDiscard: boolean; onBreakdown: () => void;
  locked?: boolean; stepKey?: string; selectedHand?: string | null; selectedSlot?: number | null;
  discardMode?: boolean; discardIds?: string[]; canDrag?: boolean;
  onSelect?: (id: string, slot: number | null) => boolean;
  onDiscardOpen?: () => boolean; onDiscardSelect?: (id: string) => boolean; onBreakdownClose?: () => void;
}
interface Props { state: RunState; send: (action: GameAction, input?: 'click' | 'drag' | 'keyboard') => void; detail: (id: string) => void; charm: (id: string) => void; settings?: OperationSettings & { animation?: boolean }; teaching?: Teaching; onMenu?: () => void; onSettings?: () => void; onDeck?: () => void; }
export function BattleScreen({ state, send, detail, charm, settings = DEFAULT_OPERATIONS, teaching, onMenu, onSettings, onDeck }: Props) {
  const battle = state.battle!;
  const health = teaching?.health ?? battle.maxHp;
  const [selected, setSelected] = useState<string | null>(teaching?.selectedHand ?? null);
  const [discardMode, setDiscardMode] = useState(teaching?.discardMode ?? false);
  const [discardIds, setDiscardIds] = useState<string[]>(teaching?.discardIds ?? []);
  const [overview, setOverview] = useState(false);
  const [breakdown, setBreakdown] = useState(teaching?.stepKey === 'damage-read');
  const [moveSlot, setMoveSlot] = useState<number | null>(teaching?.selectedSlot ?? null);
  const [bossOpen, setBossOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const anchors = useRef<HandAnchors | null>(null);
  const pendingOrder = useRef<{ revision: number; anchors: HandAnchors } | null>(null);
  if (pendingOrder.current && state.revision >= pendingOrder.current.revision) {
    if (state.revision === pendingOrder.current.revision && battle.hand.join('|') === pendingOrder.current.anchors.hand.join('|')) anchors.current = pendingOrder.current.anchors;
    pendingOrder.current = null;
  }
  anchors.current = reconcileHandAnchors(anchors.current, battle.hand, battle.slots, `${battle.completedPlays}:${battle.activeDiscards}`);
  const [targeting, setTargeting] = useState<string | null>(null);
  const targetGesture = useRef<{ cardId: string; expires: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const gesture = useCardGesture({ root, settings, disabled: teaching?.canDrag === false || discardMode || overview || breakdown || !!targeting, revision: state.revision, commit: action => {
    if (action.type === 'reorderHand' && anchors.current) {
      const candidate = act(state, action);
      if (candidate.ok) pendingOrder.current = { revision: candidate.state.revision, anchors: reorderHandAnchors(anchors.current, action.cardId, action.beforeId, candidate.state.battle!.hand) };
    }
    if (!teaching?.locked) { setSelected(null); setMoveSlot(null); }
    send(action, 'drag');
  } });
  const drag = gesture.view?.active ? gesture.view : null;
  const previewState = useMemo(() => {
    if (!settings.dragPreview || !drag) return state;
    const command = dropAction(drag.source, drag.target);
    if (!command || command.type === 'reorderHand') return state;
    const candidate = act(state, command);
    return candidate.ok ? candidate.state : state;
  }, [state, settings.dragPreview, drag?.source, drag?.target]);
  const enemy = enemiesFor(state).find(item => item.id === battle.enemyId)!;
  const preview = useMemo(() => previewBattle(previewState), [previewState]);
  const choices = getBattleChoices(state);
  const targetChoice = choices.find(choice => choice.key === targeting);
  const equipment = useMemo(() => getEquipment(previewState), [previewState]);
  const skillCues = useMemo(() => battleSkillCues(previewState), [previewState]);
  const targetCard = (id: string): boolean => {
    if (!targeting) return false;
    if (targetChoice?.options.some(option => option.id === id)) {
      // A native double click finishes after the first click has closed target mode.
      // Its remaining events must not become an unrelated quick-place command.
      targetGesture.current = { cardId: id, expires: Date.now() + 1000 };
      send({ type: 'target', key: targeting, targetId: id });
      setTargeting(null); setSelected(null); setMoveSlot(null);
    }
    return true;
  };
  const trailingTargetGesture = (id: string) => targetGesture.current?.cardId === id && Date.now() < targetGesture.current.expires;
  const chooseHand = (id: string, clickCount = 0) => {
    if (teaching?.locked) { if (discardMode) teaching.onDiscardSelect?.(id); else teaching.onSelect?.(id, null); return; }
    if (clickCount > 1 && trailingTargetGesture(id)) return;
    if (targetCard(id)) return;
    if (discardMode) setDiscardIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : previous.length < 5 ? [...previous, id] : previous);
    else { setSelected(previous => previous === id ? null : id); setMoveSlot(null); }
  };
  const place = (slot: number, input: 'click' | 'keyboard') => {
    if (discardMode) return;
    if (targeting) { const id = battle.slots[slot]; if (id) targetCard(id); return; }
    if (selected && battle.hand.includes(selected)) { send({ type: 'stage', cardId: selected, slot }, input); if (!teaching?.locked) { setSelected(null); setMoveSlot(slot); } }
    else if (moveSlot !== null) {
      const id = battle.slots[moveSlot];
      if (id && moveSlot !== slot) send({ type: 'stage', cardId: id, slot }, input);
      if (!teaching?.locked) setMoveSlot(null);
    } else if (battle.slots[slot]) { if (teaching?.locked) teaching.onSelect?.(battle.slots[slot]!, slot); else setMoveSlot(slot); }
  };
  const report = preview.report;
  const quickPlace = (id: string) => {
    if (teaching?.locked || !settings.doubleClickPlace || discardMode || drag || targeting || trailingTargetGesture(id)) return;
    const empty = battle.slots.indexOf(null);
    if (empty >= 0) { send({ type: 'stage', cardId: id, slot: empty }); setSelected(null); setMoveSlot(null); }
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !teaching?.locked) { setSelected(null); setMoveSlot(null); setDiscardIds([]); setDiscardMode(false); setTargeting(null); } };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [teaching?.locked]);
  useEffect(() => {
    if (!teaching) return;
    setSelected(teaching.selectedHand ?? null); setMoveSlot(teaching.selectedSlot ?? null);
    setDiscardMode(teaching.discardMode ?? false); setDiscardIds(teaching.discardIds ?? []);
    setBreakdown(teaching.stepKey === 'damage-read'); setOverview(false);
    setTargeting(null);
  }, [teaching?.stepKey]);
  useEffect(() => { if (targeting && !choices.some(choice => choice.key === targeting)) setTargeting(null); }, [state.revision, targeting]);
  const selectedInHand = selected && battle.hand.includes(selected) ? selected : null;
  const pairingSource = !discardMode && !targeting ? selectedInHand || (moveSlot !== null ? battle.slots[moveSlot] ?? null : null) : null;
  const cardAnnotations = (id: string) => {
    const hint = pairingHint(previewState, pairingSource, id);
    const owner = equipment[id];
    const isWeapon = CARD_MAP[state.cards[id]!.definitionId]!.type === 'weapon';
    const staged = battle.slots.includes(id);
    return <span className="v2-card-annotations" data-pairing={hint ? hint.best ? 'primary' : 'secondary' : undefined}>
      {hint && <span className={`v2-card-pairing ${hint.best ? 'v2-pairing-best' : ''}`}>◇ {hint.label}</span>}
      {isWeapon && staged && <span className={`v2-card-owner ${owner ? '' : 'v2-unassigned'}`}>{owner ? `装备：${CARD_MAP[state.cards[owner]!.definitionId]!.name}` : '未配属 · 需要紧邻人物'}</span>}
    </span>;
  };
  const targetClass = (id: string) => targetChoice?.options.some(option => option.id === id) ? ' v2-skill-target' : '';
  const recentReport = state.currentReports.at(-1);
  const slotRule = (index: number) => {
    if (enemy.rule === 'campaign_center' && index === 2) return '人物镇中';
    if (enemy.rule === 'campaign_empty_second' && index === 1) return '此格留空';
    if (enemy.rule === 'campaign_wings' && (index === 0 || index === 4)) return '人物守翼';
    return '';
  };
  const ghostWidth = drag?.rect.width ?? 0;
  const selectedSlotTools = moveSlot !== null && battle.slots[moveSlot] && <div className="v2-selected-slot-tools"><span>第 {moveSlot + 1} 格 · {CARD_MAP[state.cards[battle.slots[moveSlot]!]!.definitionId]!.name}</span><button aria-label={`撤回第 ${moveSlot + 1} 格`} onClick={() => { send({ type: 'unstage', slot: moveSlot }); setMoveSlot(null); }}>撤回</button><button onClick={() => detail(battle.slots[moveSlot]!)}>详情</button><button onClick={() => setMoveSlot(null)}>取消</button></div>;
  return <div ref={root} className={`v2-battle v2-battle-fixed ${teaching ? 'v2-battle-tutorial' : ''} ${settings.dragEnabled ? 'v2-drag-enabled' : ''} ${drag ? 'v2-drag-active' : ''} ${targeting ? 'v2-selecting-target' : ''}`} onPointerDownCapture={gesture.startClick} onClickCapture={gesture.cancelClick} onDoubleClickCapture={gesture.cancelClick} onDragStart={event => event.preventDefault()}>
    <BattleHud state={state} previewState={previewState} report={report} health={health} teaching={!!teaching} animation={settings.animation !== false} onBoss={() => setBossOpen(true)} onMenu={onMenu} onSettings={onSettings} />
    <section className="v2-formation" data-battle-region="formation" aria-label="五格布阵">
      <BattleForecast preview={preview} prearranging={previewState !== state} hasCards={previewState.battle!.slots.some(Boolean)} onDetails={() => { setBreakdown(true); teaching?.onBreakdown(); }} />
      <div className="v2-formation-scroll" data-v2-card-row onTouchStart={gesture.beginRowSwipe}>
        <div className="v2-slots">{battle.slots.map((id, index) => {
          const next = battle.slots[index + 1];
          const linked = !!id && !!next && (equipment[id] === next || equipment[next] === id);
          return <div title={slotRule(index) ? enemy.text : undefined} className={`v2-slot-wrap ${slotRule(index) ? 'v2-boss-slot' : ''} ${moveSlot === index ? 'v2-active' : ''}`} key={index}>
            <span className="v2-slot-number" aria-hidden="true">0{index + 1}{slotRule(index) && <em> · {slotRule(index)}</em>}</span>
            <button data-testid="v2-slot" data-v2-slot={index} data-drag-card-id={id ?? undefined} {...(id ? gesture.bind({ cardId: id, fromSlot: index }) : {})}
              onDoubleClick={() => { if (id && !targeting && !trailingTargetGesture(id) && settings.doubleClickPlace && !discardMode && !teaching?.locked) { send({ type: 'unstage', slot: index }); setMoveSlot(null); } }}
              className={`v2-slot ${id ? 'v2-slot-filled' : ''} ${drag?.source.cardId === id ? 'v2-drag-source' : ''} ${drag?.target?.kind === 'slot' && drag.target.slot === index ? 'v2-drop-target' : ''}${id ? targetClass(id) : ''}`}
              onClick={event => place(index, event.detail === 0 ? 'keyboard' : 'click')} aria-label={`第 ${index + 1} 格${id ? ` ${CARD_MAP[state.cards[id]!.definitionId]!.name}` : ' 空位'}`} aria-pressed={moveSlot === index}>
              {id ? <><CardFace definition={CARD_MAP[state.cards[id]!.definitionId]!} instance={state.cards[id]!} leader={state.leaderId === id} />{cardAnnotations(id)}</> : <span className="v2-slot-plus" aria-hidden="true">＋</span>}
            </button>
            {linked && <svg className="v2-equipment-link" data-equipment-link={index} viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true"><path d="M0 9h29M71 9h29" /><ellipse cx="42" cy="9" rx="14" ry="6" /><ellipse cx="58" cy="9" rx="14" ry="6" /></svg>}
          </div>;
        })}</div>
      </div>
      <div className="v2-battle-notice" data-battle-region="notice" hidden={!targetChoice && !selectedSlotTools}>
        {targetChoice ? <div className="v2-target-banner" role="status"><span>{targetChoice.optional ? '选择高亮兵器' : '选择高亮战术'}</span><button onClick={() => setTargeting(null)}>取消指定</button></div> : selectedSlotTools}
      </div>
    </section>
    <aside className="v2-battle-rail" data-battle-region="rail" aria-label="战场信息">
      <div className="v2-resource-strip" aria-label="出战资源"><div><small>出战</small><strong>{battle.playsLeft} / 4</strong></div><div><small>弃牌</small><strong>{battle.discardsLeft} / 3</strong></div><div><small>军势</small><strong>{battle.morale}</strong></div></div>
      <SkillPanel state={previewState} holdMs={settings.touchHoldMs} cues={skillCues} selecting={targeting} disabled={!!teaching?.locked || discardMode || !!drag} select={choice => { setTargeting(previous => previous === choice.key ? null : choice.key); setSelected(null); setMoveSlot(null); }} cancelEffect={choice => { send({ type: 'target', key: choice.key, targetId: '' }); setTargeting(null); }}>
        <BattleCharms state={previewState} report={report} inspect={charm} holdMs={settings.touchHoldMs} />
      </SkillPanel>
    </aside>
    <section className="v2-hand" data-battle-region="hand" aria-label="手牌区">
      <div data-v2-card-row onTouchStart={gesture.beginRowSwipe} className={`v2-hand-scroll ${drag?.target?.kind === 'hand' ? 'v2-drop-hand' : ''}`}>
        {anchors.current.ids.map((id, anchor) => !id || !battle.hand.includes(id)
          ? <div key={`anchor-${anchor}`} data-hand-anchor={anchor} className={`v2-hand-item v2-hand-shadow ${id ? 'v2-hand-staged' : ''}`} aria-label={id ? `${CARD_MAP[state.cards[id]!.definitionId]!.name} 已上阵` : '空手牌位'}><div className="v2-shadow-card" aria-hidden="true">{id ? <CardArt definition={CARD_MAP[state.cards[id]!.definitionId]!} className="v2-shadow-art" /> : <span className="v2-shadow-seal">◇</span>}</div></div>
          : <div data-hand-anchor={anchor} className={`v2-hand-item ${drag?.target?.kind === 'hand' && drag.target.beforeId === id ? 'v2-insert-before' : ''}`} key={id}>
            <button data-testid="v2-hand-card" data-drag-card-id={id} {...gesture.bind({ cardId: id, fromSlot: null })} onDoubleClick={() => quickPlace(id)} className={`v2-hand-card ${drag?.source.cardId === id ? 'v2-drag-source' : ''} ${gesture.view?.source.cardId === id && !gesture.view.active ? 'v2-touch-arming' : ''} ${selected === id || discardIds.includes(id) ? 'v2-selected' : ''}${targetClass(id)}`} onClick={event => chooseHand(id, event.detail)} aria-label={`${CARD_MAP[state.cards[id]!.definitionId]!.name}${discardIds.includes(id) || selected === id ? ' 已选' : ''}`} aria-pressed={selected === id || discardIds.includes(id)}>
              <CardFace definition={CARD_MAP[state.cards[id]!.definitionId]!} instance={state.cards[id]!} leader={state.leaderId === id} />{cardAnnotations(id)}{(selected === id || discardIds.includes(id)) && <span className="v2-check">✓</span>}
            </button>
          </div>)}
        {drag?.target?.kind === 'hand' && drag.target.beforeId === null && <span className="v2-insert-end" aria-hidden="true" />}
      </div>
    </section>
    <div className="v2-command-bar" data-battle-region="command">
      <div className="v2-command-tools">
        <button aria-label="全部撤回" disabled={!battle.slots.some(Boolean)} onClick={() => { send({ type: 'recallAll' }); setMoveSlot(null); setSelected(null); }}><BattleIcon kind="recall" /><span>撤回</span></button>
        <button onClick={() => setOverview(true)}>总览</button>
        <button className="v2-deck-open" aria-label="查看本局牌库" disabled={!onDeck} onClick={onDeck}><BattleIcon kind="deck" /><span>牌库 <b>{state.owned.filter(id => !state.removed.includes(id)).length}</b></span></button>
        <span className="v2-pile-counts">抽 <b>{battle.draw.length}</b><i />弃 <b>{battle.discard.length}</b></span>
        <button className="v2-result-open" aria-label="查看本次效果" disabled={!recentReport} onClick={() => setResultOpen(true)}><BattleIcon kind="report" /><span>战报</span></button>
      </div>
      <footer className="v2-battle-actions">{discardMode ? <>
        <button onClick={() => { setDiscardMode(false); setDiscardIds([]); }}>返回布阵</button>
        <button data-tutorial-action="discard-confirm" className="v2-primary" disabled={!discardIds.length || battle.discardsLeft < 1} onClick={() => { send({ type: 'discard', cardIds: discardIds }); if (!teaching?.locked) { setDiscardIds([]); setDiscardMode(false); } }}>弃掉 {discardIds.length} 张并补牌</button>
      </> : <>
        <button data-tutorial-action="discard-open" disabled={teaching?.canDiscard === false || battle.discardsLeft < 1 || !battle.hand.length} onClick={() => { if (teaching?.onDiscardOpen && !teaching.onDiscardOpen()) return; setDiscardMode(true); setSelected(null); setMoveSlot(null); setTargeting(null); }}>弃牌 <span>{battle.discardsLeft} / 3</span></button>
        <button className="v2-primary v2-play" disabled={!!targeting || teaching?.canPlay === false || !report || !!preview.error || battle.playsLeft < 1} onClick={() => { send({ type: 'play' }); setSelected(null); setMoveSlot(null); }}>出战破阵 <span aria-hidden="true">⚔</span></button>
      </>}</footer>
    </div>
    {bossOpen && <Modal title="本关首领与规则" close={() => setBossOpen(false)}><CampaignProgress state={state} /><BossIntel state={state} live /></Modal>}
    {resultOpen && <Modal title="本次出战效果" close={() => setResultOpen(false)}><PlayResult report={recentReport} expanded /></Modal>}
    {drag && <div data-testid="v2-drag-ghost" className="v2-drag-ghost" aria-hidden="true" style={{ left: Math.max(12, Math.min(window.innerWidth - ghostWidth - 12, drag.point.x - ghostWidth / 2)), top: Math.max(12, drag.point.y - (drag.touch ? drag.rect.height + 16 : 45)), width: ghostWidth, height: drag.rect.height }}><CardFace definition={CARD_MAP[state.cards[drag.source.cardId]!.definitionId]!} instance={state.cards[drag.source.cardId]!} leader={state.leaderId === drag.source.cardId} /><span>{drag.target ? drag.target.kind === 'slot' ? `放入第 ${drag.target.slot + 1} 格` : drag.source.fromSlot === null ? '调整手牌顺序' : '返回手牌' : '松开取消'}</span></div>}
    {overview && <Modal title="战场总览 · 职业与加成" close={() => setOverview(false)} wide><CardLegend /><BattleOverview state={state} choose={id => { chooseHand(id); setOverview(false); }} /></Modal>}
    {breakdown && <Modal title="结算明细" close={() => { setBreakdown(false); teaching?.onBreakdownClose?.(); }}>{report ? <><p className="v2-large-equation">{report.power} × {report.amp} = <strong>{report.damage}</strong></p><p>预计有效伤害 {report.actualDamage} · 溢出 {report.overflow}</p><div className="v2-breakdown">{report.sources.map((source, index) => <div key={index}><span>{source.label}</span><b>{source.power ? `威力 ${source.power > 0 ? '+' : ''}${source.power} ` : ''}{source.amp ? `增幅 ${source.amp > 0 ? '+' : ''}${source.amp}` : ''}{source.multiplier ? ` ×${source.multiplier}` : ''}</b></div>)}</div>{report.notes.map((note, index) => <p key={index}>{note}</p>)}</> : <p>{preview.error ?? '请先布阵。'}</p>}{state.currentReports.length > 0 && <details><summary>本战已出战记录</summary>{state.currentReports.map((item, index) => <p key={index}>第 {index + 1} 手 · {item.power} × {item.amp} = {item.damage}</p>)}</details>}</Modal>}
  </div>;
}
