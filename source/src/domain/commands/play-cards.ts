import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { RngPort } from '../ports/rng-port';
import type { EnhancementBalance } from '@config/schemas/balance.schema';
import type { CardDefinition } from '../models/card-definition';
import type { DefinitionId, InstanceId } from '../models/ids';
import { clearThisPlayStats, gainMorale, withZone } from '../models/card-instance';
import type { PlaySlot } from '../models/zone';
import type { GameState } from '../state/game-state';
import type { BattleEvent } from '../events/battle-events';
import type { BattleRules } from '../systems/battle-rules';
import { buildPlaySnapshot, type PlaySlotAssignment } from '../systems/play-snapshot';
import { resolveEquipments } from '../systems/weapon-matching';
import { calculateDamage } from '../systems/damage-calculator';
import { drawToHandLimit } from '../systems/zone-transfers';
import { endBattle } from '../systems/battle-end';
import type { DomainOutcome } from '../systems/battle-setup';
import { resolveEffects } from '../effects/effect-registry';
import type { TracePort } from '../diagnostics/trace';

/**
 * 主动出战。
 *
 * 顺序固定为：放入出牌框并锁定快照 → 确认装备关系 → 获得军势 → 结算伤害 → 离场 → 补牌 → 判定胜负。
 * 技能效果由阶段 5 的效果系统在结算前后插入，不改变本文件的顺序。
 */

export interface PlayCardsInput {
  readonly trace?: TracePort;
  readonly state: GameState;
  readonly rules: BattleRules;
  readonly rng: RngPort;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly enhancementSkills?: EnhancementBalance['legendarySkillPool'];
  readonly assignments: readonly PlaySlotAssignment[];
  /** 玩家指定的装备目标：武器实例 ID → 人物实例 ID。 */
  readonly targets?: Readonly<Record<string, InstanceId>>;
}

export function playCards(input: PlayCardsInput): Result<DomainOutcome, AppError> {
  const { state, rules, rng, definitions } = input;
  const battle = state.battle;
  if (battle === null) {
    return err(createAppError(AppErrorCode.CommandRejected, '当前不在战斗中，无法出战'));
  }
  if (battle.status !== 'in_progress') {
    return err(createAppError(AppErrorCode.CommandRejected, '本场战斗已经结束'));
  }
  const staged = state.zones.playSlots.filter((entry): entry is InstanceId => entry !== null);
  if (input.assignments.length === 0) {
    return err(createAppError(AppErrorCode.InvalidCommand, '至少需要选择一张卡'));
  }
  if (input.assignments.length > rules.playSlotCount) {
    return err(createAppError(AppErrorCode.InvalidCommand, '出牌数量超过出牌框格数', {
      playSlotCount: rules.playSlotCount,
    }));
  }

  const usedSlots = new Set<number>();
  const selected = new Set<InstanceId>();
  for (const assignment of input.assignments) {
    if (!Number.isInteger(assignment.slotIndex) || assignment.slotIndex < 0 || assignment.slotIndex >= rules.playSlotCount) {
      return err(createAppError(AppErrorCode.InvalidCommand, '出牌框格位越界', { slotIndex: assignment.slotIndex }));
    }
    if (usedSlots.has(assignment.slotIndex)) {
      return err(createAppError(AppErrorCode.InvalidCommand, '同一格位被重复占用', { slotIndex: assignment.slotIndex }));
    }
    usedSlots.add(assignment.slotIndex);
    if (selected.has(assignment.instanceId)) {
      return err(createAppError(AppErrorCode.InvalidCommand, '同一张卡被放入多个格位', { instanceId: assignment.instanceId }));
    }
    selected.add(assignment.instanceId);
    const instance = state.cards[assignment.instanceId];
    if (
      instance === undefined ||
      (instance.zone !== 'hand' &&
        !(instance.zone === 'playSlot' && state.zones.playSlots[assignment.slotIndex] === assignment.instanceId))
    ) {
      return err(createAppError(AppErrorCode.InvalidCommand, '所选卡牌不在手牌区', { instanceId: assignment.instanceId }));
    }
  }
  if (staged.some((instanceId) => !selected.has(instanceId))) {
    return err(createAppError(AppErrorCode.InvalidCommand, '出牌框中有未参与本次出战的卡'));
  }

  const slots: PlaySlot[] = [...state.zones.playSlots];
  let cards = state.cards;
  for (const assignment of input.assignments) {
    const instance = cards[assignment.instanceId];
    if (instance === undefined) {
      continue;
    }
    slots[assignment.slotIndex] = assignment.instanceId;
    cards = { ...cards, [assignment.instanceId]: withZone(instance, 'playSlot', assignment.slotIndex) };
  }

  const hand = state.zones.hand.filter((instanceId) => !selected.has(instanceId));
  const targets = input.targets ?? state.equipmentTargets;
  const snapshot = buildPlaySnapshot(slots, hand, cards, battle, targets);
  const events: BattleEvent[] = [
    { type: 'CardsPlayed', instanceIds: snapshot.participantIds, slotIndexes: [...usedSlots] },
  ];

  const equipments = resolveEquipments({
    slots,
    cards,
    definitions,
    rules,
    targets,
  });
  if (!equipments.ok) {
    return err(equipments.error);
  }
  if (equipments.value.weaponsNeedingTarget.length > 0) {
    const weaponInstanceId = equipments.value.weaponsNeedingTarget[0] ?? '';
    return err(
      createAppError(AppErrorCode.InvalidCommand, '武器两侧均为人物，必须先选择装备目标', { weaponInstanceId }),
    );
  }

  for (const binding of equipments.value.bindings) {
    const weapon = cards[binding.weaponInstanceId];
    if (weapon !== undefined) {
      cards = {
        ...cards,
        [binding.weaponInstanceId]: { ...weapon, equippedToInstanceId: binding.targetInstanceId },
      };
    }
    events.push({
      type: 'WeaponEquipped',
      weaponInstanceId: binding.weaponInstanceId,
      targetInstanceId: binding.targetInstanceId,
    });
  }

  let moraleTotal = battle.moraleTotal;
  for (const instanceId of snapshot.participantIds) {
    const instance = cards[instanceId];
    const definition = instance === undefined ? undefined : definitions.get(instance.definitionId);
    if (instance === undefined || definition === undefined || definition.cardType !== 'character') {
      continue;
    }
    const withMorale = gainMorale(instance, 1);
    cards = { ...cards, [instanceId]: withMorale };
    moraleTotal += 1;
    events.push({ type: 'MoraleGained', instanceId, morale: withMorale.morale });
  }

  let workingState: GameState = {
    ...state,
    cards,
    zones: { ...state.zones, hand, playSlots: slots },
    battle: { ...battle, moraleTotal },
  };
  const onPlay = resolveEffects({
    trace: input.trace,
    state: workingState,
    snapshot,
    definitions,
    bindings: equipments.value.bindings,
    timing: 'on_play',
    enhancementSkills: input.enhancementSkills ?? [],
  });
  workingState = onPlay.state;
  cards = workingState.cards;
  events.push(...onPlay.events);

  const breakdown = calculateDamage({
    trace: input.trace,
    participantIds: snapshot.participantIds,
    cards,
    definitions,
    bindings: equipments.value.bindings,
    moraleTotal,
    moraleTier: battle.moraleTier,
    rules,
    zonePowerBonus: onPlay.zonePower,
    zoneAmpBonus: onPlay.zoneAmp,
  });

  const enemyCurrentHp = Math.max(0, battle.enemyCurrentHp - breakdown.damage);
  events.push({
    type: 'DamageResolved',
    amount: breakdown.damage,
    powerTotal: breakdown.powerTotal,
    ampTotal: breakdown.ampTotal,
    enemyHpAfter: enemyCurrentHp,
  });

  workingState = {
    ...workingState,
    battle: { ...battle, enemyCurrentHp, moraleTotal },
  };
  const afterResolve = resolveEffects({
    trace: input.trace,
    state: workingState,
    snapshot,
    definitions,
    bindings: equipments.value.bindings,
    timing: 'after_resolve',
    enhancementSkills: input.enhancementSkills ?? [],
  });
  workingState = afterResolve.state;
  cards = workingState.cards;
  events.push(...afterResolve.events);

  for (const instanceId of snapshot.participantIds) {
    const instance = cards[instanceId];
    if (instance !== undefined) {
      cards = { ...cards, [instanceId]: clearThisPlayStats(instance) };
    }
  }

  const afterLeave: GameState = {
    ...workingState,
    cards,
    equipmentTargets: {},
    zones: {
      ...state.zones,
      hand,
      playSlots: slots.map(() => null),
      discardPile: [...state.zones.discardPile, ...snapshot.participantIds],
    },
    battle: {
      ...battle,
      enemyCurrentHp,
      moraleTotal,
      playCountRemaining: battle.playCountRemaining - 1,
      completedPlays: battle.completedPlays + 1,
    },
  };

  const leftCards = { ...afterLeave.cards };
  for (const instanceId of snapshot.participantIds) {
    const instance = leftCards[instanceId];
    if (instance !== undefined) {
      leftCards[instanceId] = withZone(instance, 'discardPile', null);
    }
  }
  const afterLeaveWithZones: GameState = { ...afterLeave, cards: leftCards };

  const drawn = drawToHandLimit(afterLeaveWithZones, rules, rng);
  if (drawn.reshuffledCount > 0) {
    events.push({ type: 'DeckReshuffled', count: drawn.reshuffledCount });
  }
  if (drawn.drawn.length > 0) {
    events.push({ type: 'CardsDrawn', instanceIds: drawn.drawn });
  }

  const finished = drawn.state.battle;
  if (finished === null) {
    return ok({ state: drawn.state, events });
  }
  if (finished.enemyCurrentHp <= 0) {
    const ended = endBattle(drawn.state, true);
    return ok({ state: ended.state, events: [...events, ...ended.events] });
  }
  if (finished.playCountRemaining <= 0) {
    const ended = endBattle(drawn.state, false);
    return ok({ state: ended.state, events: [...events, ...ended.events] });
  }

  return ok({ state: drawn.state, events });
}
