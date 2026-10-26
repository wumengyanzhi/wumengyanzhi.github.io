import type { ReactElement } from 'react';
import type { MatchRelation } from '@domain/models/enums';
import type { InstanceId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';
import type { SelectorContext } from '@app/selectors';
import {
  selectDamagePreview,
  selectMatchHint,
  selectResources,
  selectWeaponTargetCandidates,
} from '@app/selectors';
import { CardDetail, type EnhancementSkillText } from '../cards/card-detail';
import type { CardFace } from '../cards/card-face';
import { matchLines, type MatchLine } from '../cards/match-text';
import { faceOf, facesOf, slotFaces } from '../cards/to-face';
import { DragProvider, type DropTargetQuery } from '../drag/drag-context';
import type { DragSession, ResolvedDrop } from '../drag/snap';
import type { ScreenProps } from '../state/screen-props';
import { DamagePreviewPanel } from './damage-preview';
import { HandRow } from './hand-row';
import { PlaySlots, computeLinks, relationFor, type MatrixTable } from './play-slots';
import { WeaponTargetDialog, type TargetOption } from './weapon-target-dialog';

/**
 * 战斗幕：出牌框场 + 手牌带 + 底栏。
 *
 * 顶栏（三战进度 / 敌人 / 军资）由 App 渲染，这里只负责「玩家每一手怎么打」这一件事。
 * 所有数字都是从 selectors 拿的现成结果，界面一行都不算伤害。
 */

const SLOT_LABELS = ['一', '二', '三', '四', '五'];

/** 兵器配属候选：档位与增幅直接复用连营线的查表口径，界面与关联展示不会各说各话。 */
function buildTargetOptions(
  weaponInstanceId: InstanceId,
  candidateIds: readonly InstanceId[],
  state: GameState,
  selectors: SelectorContext,
): readonly TargetOption[] {
  const weapon = faceOf(state, selectors.definitions, weaponInstanceId);
  if (weapon === null) return [];
  const options: TargetOption[] = [];
  for (const candidateId of candidateIds) {
    const target = faceOf(state, selectors.definitions, candidateId);
    if (target === null) continue;
    options.push({
      face: target,
      ...relationFor(weapon, target, selectors.rules.matrix, selectors.rules.relationAmp),
    });
  }
  return options;
}

export type PairHint = { readonly relation: MatchRelation; readonly ampBonus: number };

/**
 * 选中联动：选中人物时给手牌里的每件兵器标档位，选中兵器时给每个人物标档位。
 * 查表口径与连营线、配属对话框共用同一个 relationFor，三处不会各说各话。
 */
export function computePairs(
  cards: readonly CardFace[],
  selected: CardFace | null,
  matrix: MatrixTable,
  relationAmp: Readonly<Record<MatchRelation, number>>,
): ReadonlyMap<InstanceId, PairHint> {
  const pairs = new Map<InstanceId, PairHint>();
  if (selected === null) return pairs;
  for (const face of cards) {
    if (face.instanceId === selected.instanceId) continue;
    const weapon = selected.cardType === 'weapon' ? selected : face.cardType === 'weapon' ? face : null;
    const target = selected.cardType === 'character' ? selected : face.cardType === 'character' ? face : null;
    if (weapon === null || target === null) continue;
    pairs.set(face.instanceId, relationFor(weapon, target, matrix, relationAmp));
  }
  return pairs;
}

/** 手牌上每张牌自带的相性速查：兵器写职业，人物写兵器。 */
export function computeMatches(
  cards: readonly CardFace[],
  selectors: SelectorContext,
): ReadonlyMap<InstanceId, readonly MatchLine[]> {
  const matches = new Map<InstanceId, readonly MatchLine[]>();
  for (const face of cards) {
    matches.set(face.instanceId, matchLines(selectMatchHint(face.definitionId, selectors), selectors.rules.relationAmp));
  }
  return matches;
}

function statusLabelOf(state: GameState, instanceId: InstanceId): string {
  const slotIndex = state.zones.playSlots.indexOf(instanceId);
  if (slotIndex >= 0) return `已放第${SLOT_LABELS[slotIndex] ?? String(slotIndex + 1)}格`;
  return state.zones.hand.includes(instanceId) ? '在手牌' : '不在手上';
}

function equippedToNameOf(state: GameState, selectors: SelectorContext, instanceId: InstanceId): string | null {
  const targetId = state.equipmentTargets[instanceId];
  if (targetId === undefined) return null;
  return faceOf(state, selectors.definitions, targetId)?.name ?? null;
}

/** 这个落点能不能接住正在飞的这张牌；只看「格子空不空」这一条，其余交给领域命令去判。 */
function legalityReader(
  state: GameState,
  slotCount: number,
): (query: DropTargetQuery) => boolean {
  return ({ session, zone }: DropTargetQuery): boolean => {
    if (zone.kind !== 'slot') return false;
    if (zone.index < 0 || zone.index >= slotCount) return false;
    const occupant = state.zones.playSlots[zone.index] ?? null;
    if (session.source.kind === 'slot') {
      // 放回原格是合法的空操作，换个空格才是真的移动。
      return session.source.slotIndex === zone.index || occupant === null;
    }
    return occupant === null;
  };
}

/** 拖拽是同一批命令的另一条入口：合法落点转成命令，非法落点原地弹回，规则一处都不会绕过。 */

export function BattleScreen({
  state,
  registry,
  selectors,
  ui,
  actions,
  dispatch,
}: ScreenProps): ReactElement | null {
  const battle = state.battle;
  if (battle === null || battle.status !== 'in_progress') return null;

  const { definitions, rules } = selectors;
  const hand = facesOf(state, definitions, state.zones.hand);
  const slots = slotFaces(state, definitions);
  const resources = selectResources(state, selectors);

  // 已经指定过归属的兵器不再等待；只有两侧都是人物且未指定的才算待选。
  const pending = selectWeaponTargetCandidates(state, selectors).filter(
    (candidate) => state.equipmentTargets[candidate.weaponInstanceId] === undefined,
  );
  const awaitingTargets = pending.map((candidate) => candidate.weaponInstanceId);

  const staged = slots.some((face) => face !== null);
  const preview = staged ? selectDamagePreview(state, selectors) : null;
  const links = computeLinks(slots, awaitingTargets, rules.matrix, rules.relationAmp);
  const canAct = battle.playCountRemaining > 0;

  // 选中联动与卡面相性：都在渲染前算好，组件只负责把结果显示出来。
  const selectedFace = ui.selectedHand === null ? null : faceOf(state, definitions, ui.selectedHand);
  const pairs = computePairs(hand, selectedFace, rules.matrix, rules.relationAmp);
  const matches = computeMatches(hand, selectors);

  const detailFace = ui.detailInstanceId === null ? null : faceOf(state, definitions, ui.detailInstanceId);
  const targetWeapon = ui.targetWeaponId === null
    ? null
    : pending.find((candidate) => candidate.weaponInstanceId === ui.targetWeaponId) ?? null;
  const targetWeaponFace = targetWeapon === null ? null : faceOf(state, definitions, targetWeapon.weaponInstanceId);

  function place(slotIndex: number): void {
    const id = ui.selectedHand;
    if (id === null) return;
    if (!dispatch({ type: 'StageCard', instanceId: id, slotIndex })) return;
    if (ui.discardIds.includes(id)) actions.toggleDiscard(id);
    actions.selectHand(null);
  }

  function retrieve(slotIndex: number): void {
    dispatch({ type: 'UnstageCard', slotIndex });
  }

  function play(): void {
    const assignments = state.zones.playSlots.flatMap((instanceId, slotIndex) =>
      instanceId === null || instanceId === undefined ? [] : [{ slotIndex, instanceId }],
    );
    if (assignments.length === 0) return;
    if (!dispatch({ type: 'Play', assignments })) return;
    actions.selectHand(null);
    actions.clearDiscard();
  }

  function discard(): void {
    if (ui.discardIds.length === 0) return;
    if (!dispatch({ type: 'Discard', instanceIds: [...ui.discardIds] })) return;
    actions.selectHand(null);
    actions.clearDiscard();
  }

  function pickTarget(targetInstanceId: InstanceId): void {
    if (targetWeapon === null) return;
    dispatch({
      type: 'SelectWeaponTarget',
      weaponInstanceId: targetWeapon.weaponInstanceId,
      targetInstanceId,
    });
    actions.closeTargets();
  }

  // 拖拽只是同一批命令的另一条入口：合法的转成命令，非法的原地弹回，规则一处都不会绕过。
  const dragEnabled = true;
  const isLegalTarget = legalityReader(state, rules.playSlotCount);

  function handleCardDrop(session: DragSession, target: ResolvedDrop | null): void {
    if (target === null || target.zone.kind !== 'slot') return;
    const slotIndex = target.zone.index;

    if (session.source.kind === 'hand') {
      if (!dispatch({ type: 'StageCard', instanceId: session.instanceId, slotIndex })) return;
      if (ui.discardIds.includes(session.instanceId)) actions.toggleDiscard(session.instanceId);
      actions.selectHand(null);
      return;
    }

    const from = session.source.slotIndex;
    if (from === slotIndex) return;
    // 先撤回原位再落新格：两步都是领域命令，中途失败也只是牌回到手上，不会出现卡在两个格子里的牌。
    if (!dispatch({ type: 'UnstageCard', slotIndex: from })) return;
    dispatch({ type: 'StageCard', instanceId: session.instanceId, slotIndex });
  }

  const body = (
    <>
      {pending.length > 0 && (
        <div className="pending-banner" role="status">
          <strong>有 {pending.length} 件兵器两侧都是人物，必须先指定归属才能结算。</strong>
          <button type="button" className="btn btn--ghost" onClick={() => {
            const first = pending[0];
            if (first !== undefined) actions.openTargets(first.weaponInstanceId);
          }}
          >
            去指定
          </button>
        </div>
      )}

      <section className="panel field" aria-label="出牌框">
        <div className="field__head">
          <h2 className="panel-title">出牌框 · 五格连营</h2>
          <p className="field__hint">
            手牌可以直接拖进空格，也可点牌再点空位；框里的牌拖到另一格能换位置，拖到框外会弹回手上。
            相邻的一对人物与兵器才产生增幅，空位会把连营线隔断。
          </p>
        </div>
        <div className="field__body">
          <PlaySlots
            slots={slots}
            links={links}
            hasSelection={ui.selectedHand !== null}
            awaitingTargets={awaitingTargets}
            dragEnabled={dragEnabled}
            onPlace={place}
            onRetrieve={retrieve}
          />
          <DamagePreviewPanel
            preview={preview}
            staged={staged}
            pendingTargets={pending.length}
            canAct={canAct}
            onPlay={play}
            onPickTargets={() => {
              const first = pending[0];
              if (first !== undefined) actions.openTargets(first.weaponInstanceId);
            }}
          />
        </div>
      </section>

      <section className="panel hand" aria-label="手牌区">
        <div className="hand__head">
          <span className="hand__title">
            <strong>手 牌</strong>
            <span className="hand__meta">
              {state.zones.hand.length} 张 · 上限 {resources.handLimit} · 选中后可放入出牌框空位
            </span>
          </span>
          <div className="hand__actions">
            <span className="hand__hint">
              已标记 {ui.discardIds.length} 张，弃牌机会还剩 {resources.discardCountRemaining} 次
            </span>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={ui.discardIds.length === 0 || resources.discardCountRemaining <= 0}
              onClick={discard}
            >
              弃掉所选并补牌
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={ui.discardIds.length === 0}
              onClick={actions.clearDiscard}
            >
              清空标记
            </button>
          </div>
        </div>
        <HandRow
          cards={hand}
          selectedId={ui.selectedHand}
          discardIds={ui.discardIds}
          discardRemaining={resources.discardCountRemaining}
          maxDiscardSelection={rules.maxDiscardSelection}
          dragEnabled={dragEnabled}
          pairs={pairs}
          matches={matches}
          onSelect={(id) => actions.selectHand(ui.selectedHand === id ? null : id)}
          onToggleDiscard={actions.toggleDiscard}
          onInspect={actions.openDetail}
        />
      </section>

      <footer className="statusbar">
        <span>剩余出战 <strong className="num">{battle.playCountRemaining}</strong> / {rules.playCount} 次</span>
        <span>本场已结算 <strong className="num">{battle.completedPlays}</strong> 手</span>
        <span>抽牌堆 <strong className="num">{state.zones.drawPile.length}</strong></span>
        <span>弃牌堆 <strong className="num">{state.zones.discardPile.length}</strong></span>
        {ui.lastDamage !== null && <span>上一手造成 <strong className="num">{ui.lastDamage}</strong> 点伤害</span>}
        <span className="sr-only">空位隔断相邻关系，连营线上会显示「隔断」。</span>
      </footer>

      {detailFace !== null && (
        <CardDetail
          face={detailFace}
          match={matchLines(selectMatchHint(detailFace.definitionId, selectors), rules.relationAmp)}
          effects={registry.getCardDefinition(detailFace.definitionId)?.effects ?? []}
          enhancementSkills={registry.config.enhancement.legendarySkillPool as readonly EnhancementSkillText[]}
          moralePowerPerPoint={rules.moralePowerPerPoint}
          statusLabel={statusLabelOf(state, detailFace.instanceId)}
          equippedToName={equippedToNameOf(state, selectors, detailFace.instanceId)}
          onClose={actions.closeDetail}
        />
      )}

      {targetWeapon !== null && targetWeaponFace !== null && (
        <WeaponTargetDialog
          weapon={targetWeaponFace}
          options={buildTargetOptions(
            targetWeapon.weaponInstanceId,
            targetWeapon.candidateInstanceIds,
            state,
            selectors,
          )}
          onPick={pickTarget}
          onClose={actions.closeTargets}
        />
      )}
    </>
  );

  return (
    <DragProvider enabled={dragEnabled} isLegalTarget={isLegalTarget} onDrop={handleCardDrop}>
      {body}
    </DragProvider>
  );
}
