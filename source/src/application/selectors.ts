import type { EnhancementBalance } from '@config/schemas/balance.schema';
import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { CardDefinition } from '@domain/models/card-definition';
import { effectiveAmp, effectivePower } from '@domain/models/card-instance';
import { PROFESSIONS, WEAPON_CLASSES, type MatchRelation } from '@domain/models/enums';
import type { DefinitionId, InstanceId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';
import type { BattleRules } from '@domain/systems/battle-rules';
import type { RngPort } from '@domain/ports/rng-port';
import { playCards } from '@domain/commands/play-cards';
import { findWeaponsNeedingTarget, type WeaponTargetCandidates } from '@domain/commands/select-target';

/**
 * 只读派生视图。
 *
 * 界面读这里，不直接翻 GameState。所有派生都不写状态；预测伤害调用领域出战流程取结果，
 * 界面自己算公式是被禁止的——一旦 UI 与领域各有一份公式，数值必然漂移。
 */

export interface SelectorContext {
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly rules: BattleRules;
  readonly rng: RngPort;
  readonly enhancementSkills: EnhancementBalance['legendarySkillPool'];
}

export interface CardView {
  readonly instanceId: InstanceId;
  readonly definitionId: DefinitionId;
  readonly name: string;
  readonly cardType: CardDefinition['cardType'];
  readonly rarity: CardDefinition['rarity'];
  readonly basePower: number;
  readonly baseAmp: number;
  /** 基础 + 本局永久 + 本场临时 + 本次，四层之和。 */
  readonly power: number;
  readonly amp: number;
  readonly morale: number;
}

export interface PlaySlotView {
  readonly slotIndex: number;
  /** 空位用 null 表示：空位隔断相邻关系，界面必须把它画出来。 */
  readonly card: CardView | null;
}

export interface ResourceBar {
  readonly playCountRemaining: number;
  readonly discardCountRemaining: number;
  readonly handSize: number;
  readonly handLimit: number;
  readonly gold: number;
}

export interface DamagePreview {
  readonly damage: number;
  readonly powerTotal: number;
  readonly ampTotal: number;
  readonly enemyHpAfter: number;
}

function toCardView(state: GameState, context: SelectorContext, instanceId: InstanceId): CardView | null {
  const instance = state.cards[instanceId];
  if (instance === undefined) return null;
  const definition = context.definitions.get(instance.definitionId);
  if (definition === undefined) return null;
  const baseAmp = definition.cardType === 'character' ? 0 : definition.baseAmp;
  return {
    instanceId,
    definitionId: instance.definitionId,
    name: definition.name,
    cardType: definition.cardType,
    rarity: definition.rarity,
    basePower: definition.basePower,
    baseAmp,
    power: definition.basePower + effectivePower(instance),
    amp: baseAmp + effectiveAmp(instance),
    morale: instance.morale,
  };
}

export function selectHand(state: GameState, context: SelectorContext): readonly CardView[] {
  const views: CardView[] = [];
  for (const instanceId of state.zones.hand) {
    const view = toCardView(state, context, instanceId);
    if (view !== null) views.push(view);
  }
  return views;
}

export function selectPlaySlots(state: GameState, context: SelectorContext): readonly PlaySlotView[] {
  return state.zones.playSlots.map((instanceId, slotIndex) => ({
    slotIndex,
    card: instanceId === null || instanceId === undefined ? null : toCardView(state, context, instanceId),
  }));
}

/** 可放置区域：出牌框中的空位。 */
export function selectEmptySlotIndexes(state: GameState): readonly number[] {
  const empty: number[] = [];
  state.zones.playSlots.forEach((entry, index) => {
    if (entry === null || entry === undefined) empty.push(index);
  });
  return empty;
}

export function selectWeaponTargetCandidates(
  state: GameState,
  context: SelectorContext,
): readonly WeaponTargetCandidates[] {
  return findWeaponsNeedingTarget(state.zones.playSlots, state.cards, context.definitions);
}

/**
 * 相性速查：一张牌跟谁配能拿多少增幅。
 *
 * 兵器卡列出各档位对应的职业，人物卡列出各档位对应的兵器分类——
 * 玩家不用先放下去试，看卡面就知道这把刀该给谁。
 * 只做配置表的反查，不判定任何规则；顺序按枚举常量固定，避免界面每次渲染顺序跳动。
 */
export interface MatchHintView {
  /** 兵器卡列「职业」，人物卡列「兵器分类」；其余牌型没有相性。 */
  readonly kind: 'weapon' | 'character';
  readonly main: readonly string[];
  readonly usable: readonly string[];
  readonly off: readonly string[];
}

interface Buckets {
  readonly main: string[];
  readonly usable: string[];
  readonly off: string[];
}

function bucket(buckets: Buckets, relation: MatchRelation | undefined, key: string): void {
  if (relation === undefined || relation === 'none') return;
  buckets[relation].push(key);
}

export function selectMatchHint(definitionId: DefinitionId, context: SelectorContext): MatchHintView | null {
  const definition = context.definitions.get(definitionId);
  const matrix = context.rules.matrix;
  if (definition !== undefined && definition.cardType === 'weapon' && definition.weaponClass !== null) {
    const buckets: Buckets = { main: [], usable: [], off: [] };
    for (const profession of PROFESSIONS) {
      bucket(buckets, matrix[profession]?.[definition.weaponClass], profession);
    }
    return { kind: 'weapon', ...buckets };
  }
  if (definition !== undefined && definition.cardType === 'character' && definition.profession !== null) {
    const row = matrix[definition.profession] ?? {};
    const buckets: Buckets = { main: [], usable: [], off: [] };
    for (const weaponClass of WEAPON_CLASSES) {
      bucket(buckets, row[weaponClass], weaponClass);
    }
    return { kind: 'character', ...buckets };
  }
  return null;
}

export function selectResources(state: GameState, context: SelectorContext): ResourceBar {
  return {
    playCountRemaining: state.battle?.playCountRemaining ?? 0,
    discardCountRemaining: state.battle?.discardCountRemaining ?? 0,
    handSize: state.zones.hand.length,
    handLimit: context.rules.handLimit,
    gold: state.run.gold,
  };
}

/**
 * 预测本次出战的伤害。
 *
 * 直接跑一遍领域出战流程取结算结果：不写回状态，也不消耗玩家的随机序列
 * （RngPort 是纯函数式的，预演得到的游标不会回到真实状态里）。
 */
export function selectDamagePreview(
  state: GameState,
  context: SelectorContext,
): Result<DamagePreview, AppError> {
  if (state.battle === null || state.battle.status !== 'in_progress') {
    return err(createAppError(AppErrorCode.CommandRejected, '当前不在战斗中，无法预估伤害'));
  }
  const assignments = state.zones.playSlots.flatMap((instanceId, slotIndex) =>
    instanceId === null || instanceId === undefined ? [] : [{ slotIndex, instanceId }],
  );
  if (assignments.length === 0) {
    return err(createAppError(AppErrorCode.CommandRejected, '出牌框为空，无法预估伤害'));
  }
  const played = playCards({
    state,
    rules: context.rules,
    rng: context.rng,
    definitions: context.definitions,
    assignments,
    enhancementSkills: context.enhancementSkills,
  });
  if (!played.ok) return played;
  const resolved = played.value.events.find((event) => event.type === 'DamageResolved');
  if (resolved?.type !== 'DamageResolved') {
    return err(createAppError(AppErrorCode.CommandRejected, '本次出战没有产生伤害结算'));
  }
  return ok({
    damage: resolved.amount,
    powerTotal: resolved.powerTotal,
    ampTotal: resolved.ampTotal,
    enemyHpAfter: resolved.enemyHpAfter,
  });
}
