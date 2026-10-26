import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { RngPort, RngState } from '../ports/rng-port';
import type { EffectConfig } from '@config/schemas/effect.schema';
import type { CardDefinition } from '../models/card-definition';
import type { CardInstance } from '../models/card-instance';
import type { DefinitionId, InstanceId } from '../models/ids';
import type { EffectTarget, EffectTiming, StatScope, ZoneType } from '../models/enums';
import type { BattleEvent } from '../events/battle-events';
import type { GameState } from '../state/game-state';
import type { ZonesState } from '../state/zones-state';
import type { PlaySnapshot } from '../systems/play-snapshot';
import type { EquipBinding } from '../systems/weapon-matching';
import { drawCards as drawCardsFromDeck } from '../systems/zone-transfers';
import {
  addBattleTemporaryStats,
  addPermanentStats,
  addThisPlayStats,
  withZone,
} from '../models/card-instance';
import { MAX_PATCHED_INSTANCES, effectUseKey } from './effect-limits';
import { emitTrace, type TracePort } from '../diagnostics/trace';

/**
 * 效果上下文。
 *
 * 处理器只能通过这里传入的快照、作用域与写入口读写数据，拿不到 GameState 之外的数据源，
 * 也拿不到时钟与全局单例。写入口全部返回新的上下文或结构化错误，处理器不得就地修改状态。
 *
 * 数值分四层：基础（定义）、本局永久、本场临时、本次出战。
 * 「吸收某卡威力」这类只读读取默认只看基础与本局永久，本场临时与本次加成不可被吸收，
 * 否则会出现同一份加成被反复复制的循环放大。
 */

export interface EffectScope {
  readonly timing: EffectTiming;
  /** 触发本次结算的实体。 */
  readonly sourceInstanceId: InstanceId;
  readonly effectId: string;
  /** 操作在效果内的书写顺序，从左到右。 */
  readonly operationIndex: number;
}

/**
 * 递归结算入口，由 effect-registry 注入。
 *
 * 处理器通过它重复另一个效果，避免处理器与注册表互相 import 形成环。
 */
export type ResolveEffectFn = (ctx: EffectContext, effect: EffectConfig) => Result<EffectContext, AppError>;

export interface EffectContext {
  readonly trace?: TracePort;
  readonly diagnosticEffectId?: string;
  readonly state: GameState;
  readonly snapshot: PlaySnapshot;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly bindings: readonly EquipBinding[];
  readonly rng: RngPort | null;
  /** 递归结算入口；未提供时 repeat_effect 直接被拒。 */
  readonly resolveEffect: ResolveEffectFn | null;
  readonly scope: EffectScope;
  /** 当前嵌套深度，顶层为 0。 */
  readonly depth: number;
  /** 已在处理的效果链，用于循环检测。 */
  readonly chain: readonly string[];
  /** 本次出战中已经触发过的「实例 + 效果」键。 */
  readonly usedKeys: ReadonlySet<string>;
  readonly events: readonly BattleEvent[];
  /** 作用于本次出战整体的威力与增幅，不落在具体实体上。 */
  readonly zonePower: number;
  readonly zoneAmp: number;
  readonly patchedCount: number;
}

export interface CreateEffectContextInput {
  readonly trace?: TracePort;
  readonly state: GameState;
  readonly snapshot: PlaySnapshot;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly bindings: readonly EquipBinding[];
  readonly rng?: RngPort | null;
  readonly resolveEffect?: ResolveEffectFn | null;
  readonly scope: EffectScope;
  readonly depth?: number;
  readonly chain?: readonly string[];
  readonly usedKeys?: ReadonlySet<string>;
  readonly events?: readonly BattleEvent[];
  readonly zonePower?: number;
  readonly zoneAmp?: number;
  readonly patchedCount?: number;
}

export function createEffectContext(input: CreateEffectContextInput): EffectContext {
  return {
    trace: input.trace,
    state: input.state,
    snapshot: input.snapshot,
    definitions: input.definitions,
    bindings: input.bindings,
    rng: input.rng ?? null,
    resolveEffect: input.resolveEffect ?? null,
    scope: input.scope,
    depth: input.depth ?? 0,
    chain: input.chain ?? [],
    usedKeys: input.usedKeys ?? new Set<string>(),
    events: input.events ?? [],
    zonePower: input.zonePower ?? 0,
    zoneAmp: input.zoneAmp ?? 0,
    patchedCount: input.patchedCount ?? 0,
  };
}

function invalidTarget(message: string, instanceId: string): AppError {
  return createAppError(AppErrorCode.EffectRejected, message, { instanceId });
}

/* ------------------------------ 读取口 ------------------------------ */

export function readInstance(ctx: EffectContext, instanceId: InstanceId): CardInstance | undefined {
  return ctx.state.cards[instanceId];
}

export function readDefinition(
  ctx: EffectContext,
  instanceId: InstanceId,
): CardDefinition | undefined {
  const instance = readInstance(ctx, instanceId);
  return instance === undefined ? undefined : ctx.definitions.get(instance.definitionId);
}

export function readDefinitionById(
  ctx: EffectContext,
  definitionId: DefinitionId,
): CardDefinition | undefined {
  return ctx.definitions.get(definitionId);
}

/** 可被吸收的威力：基础 + 本局永久。本场临时与本次加成不参与。 */
export function absorbablePower(ctx: EffectContext, instanceId: InstanceId): number {
  const instance = readInstance(ctx, instanceId);
  const definition = readDefinition(ctx, instanceId);
  if (instance === undefined || definition === undefined) {
    return 0;
  }
  return definition.basePower + instance.permanentPower;
}

/** 可被吸收的增幅：人物没有基础增幅，其余按定义；同样只读本局永久。 */
export function absorbableAmp(ctx: EffectContext, instanceId: InstanceId): number {
  const instance = readInstance(ctx, instanceId);
  const definition = readDefinition(ctx, instanceId);
  if (instance === undefined || definition === undefined) {
    return 0;
  }
  const definitionAmp = definition.cardType === 'character' ? 0 : definition.baseAmp;
  return definitionAmp + instance.permanentAmp;
}

export interface ResolvedTarget {
  /** zone 表示作用于本次出战整体而非具体实体。 */
  readonly kind: 'instance' | 'zone';
  readonly instanceId: InstanceId | null;
}

/**
 * 解析效果目标。
 *
 * 相邻以快照为准：结算期间即使有卡离场，也不重新连接被隔开的卡牌。
 */
export function resolveTarget(ctx: EffectContext, target: EffectTarget): ResolvedTarget | null {
  const source = ctx.scope.sourceInstanceId;
  if (target === 'zone') {
    return { kind: 'zone', instanceId: null };
  }
  if (target === 'self') {
    return { kind: 'instance', instanceId: source };
  }
  if (target === 'equipped_character') {
    const binding = ctx.bindings.find((entry) => entry.weaponInstanceId === source);
    if (binding === undefined) {
      const equippedTo = readInstance(ctx, source)?.equippedToInstanceId ?? null;
      return equippedTo === null ? null : { kind: 'instance', instanceId: equippedTo };
    }
    return { kind: 'instance', instanceId: binding.targetInstanceId };
  }
  const index = ctx.snapshot.slots.findIndex((entry) => entry === source);
  if (index < 0) {
    return null;
  }
  const neighbourId = ctx.snapshot.slots[target === 'left_neighbour' ? index - 1 : index + 1];
  if (neighbourId === null || neighbourId === undefined) {
    return null;
  }
  return { kind: 'instance', instanceId: neighbourId };
}

/* ------------------------------ 写入口 ------------------------------ */

export function patchInstance(
  ctx: EffectContext,
  instanceId: InstanceId,
  mutate: (instance: CardInstance) => CardInstance,
): Result<EffectContext, AppError> {
  const current = ctx.state.cards[instanceId];
  if (current === undefined) {
    return err(invalidTarget('效果目标不存在', instanceId));
  }
  if (ctx.patchedCount >= MAX_PATCHED_INSTANCES) {
    return err(
      createAppError(AppErrorCode.EffectRejected, '单次结算写入的实体数量超过上限', {
        patchedCount: ctx.patchedCount,
        max: MAX_PATCHED_INSTANCES,
      }),
    );
  }
  const next = mutate(current);
  for (const key of ['permanentPower', 'permanentAmp', 'battleTemporaryPower', 'battleTemporaryAmp', 'thisPlayPower', 'thisPlayAmp'] as const) {
    if (next[key] !== current[key]) emitTrace(ctx.trace, { kind: 'effect', source: ctx.scope.sourceInstanceId, target: instanceId, label: ctx.diagnosticEffectId ?? ctx.scope.effectId, timing: ctx.scope.timing, before: current[key], after: next[key], detail: key });
  }
  return ok({
    ...ctx,
    state: { ...ctx.state, cards: { ...ctx.state.cards, [instanceId]: next } },
    patchedCount: next === current ? ctx.patchedCount : ctx.patchedCount + 1,
  });
}

export function addZoneBonus(
  ctx: EffectContext,
  power: number,
  amp: number,
): EffectContext {
  if (power) emitTrace(ctx.trace, { kind: 'effect', source: ctx.scope.sourceInstanceId, label: ctx.diagnosticEffectId ?? ctx.scope.effectId, timing: ctx.scope.timing, before: ctx.zonePower, after: ctx.zonePower + power, detail: '威力区加值' });
  if (amp) emitTrace(ctx.trace, { kind: 'effect', source: ctx.scope.sourceInstanceId, label: ctx.diagnosticEffectId ?? ctx.scope.effectId, timing: ctx.scope.timing, before: ctx.zoneAmp, after: ctx.zoneAmp + amp, detail: '增幅区加值' });
  return { ...ctx, zonePower: ctx.zonePower + power, zoneAmp: ctx.zoneAmp + amp };
}

export function addGold(ctx: EffectContext, amount: number): EffectContext {
  emitTrace(ctx.trace,{kind:'resource',source:ctx.scope.sourceInstanceId,label:ctx.diagnosticEffectId??ctx.scope.effectId,timing:ctx.scope.timing,before:ctx.state.run.gold,after:ctx.state.run.gold+amount,detail:'金币'});
  return { ...ctx, state: { ...ctx.state, run: { ...ctx.state.run, gold: ctx.state.run.gold + amount } } };
}

export function spendGold(ctx: EffectContext, amount: number): Result<EffectContext, AppError> {
  if (ctx.state.run.gold < amount) {
    return err(
      createAppError(AppErrorCode.EffectRejected, '资源不足，无法支付效果消耗', {
        gold: ctx.state.run.gold,
        required: amount,
      }),
    );
  }
  return ok(addGold(ctx, -amount));
}

export function setGold(ctx: EffectContext, gold: number): EffectContext {
  emitTrace(ctx.trace,{kind:'resource',source:ctx.scope.sourceInstanceId,label:ctx.diagnosticEffectId??ctx.scope.effectId,timing:ctx.scope.timing,before:ctx.state.run.gold,after:gold,detail:'金币设值'});
  return { ...ctx, state: { ...ctx.state, run: { ...ctx.state.run, gold } } };
}

export function emit(ctx: EffectContext, event: BattleEvent): EffectContext {
  return { ...ctx, events: [...ctx.events, event] };
}

/**
 * 按作用域写入数值层。
 *
 * 四层口径固定：this_play 本次、this_battle 本场临时、permanent 本局永久；
 * 基础层来自定义，任何效果都不直接改写定义。
 */
export function addStatByScope(
  instance: CardInstance,
  scope: StatScope,
  power: number,
  amp: number,
): CardInstance {
  switch (scope) {
    case 'this_play':
      return addThisPlayStats(instance, power, amp);
    case 'this_battle':
      return addBattleTemporaryStats(instance, power, amp);
    case 'permanent':
      return addPermanentStats(instance, power, amp);
  }
}

function removeFromZones(zones: ZonesState, instanceId: InstanceId): ZonesState {
  return {
    ...zones,
    drawPile: zones.drawPile.filter((entry) => entry !== instanceId),
    hand: zones.hand.filter((entry) => entry !== instanceId),
    playSlots: zones.playSlots.map((entry) => (entry === instanceId ? null : entry)),
    discardPile: zones.discardPile.filter((entry) => entry !== instanceId),
    consumed: zones.consumed.filter((entry) => entry !== instanceId),
    removed: zones.removed.filter((entry) => entry !== instanceId),
  };
}

/**
 * 把实体移入指定牌区。
 *
 * 结算期间不允许移入出牌框，那会改变已锁定的快照。
 */
export function moveInstance(
  ctx: EffectContext,
  instanceId: InstanceId,
  to: Exclude<ZoneType, 'playSlot'>,
): Result<EffectContext, AppError> {
  const instance = ctx.state.cards[instanceId];
  if (instance === undefined) {
    return err(invalidTarget('被移动的卡牌不存在', instanceId));
  }
  const zones = removeFromZones(ctx.state.zones, instanceId);
  const nextZones: ZonesState = { ...zones, [to]: [...zones[to], instanceId] };
  return ok({
    ...ctx,
    state: {
      ...ctx.state,
      cards: { ...ctx.state.cards, [instanceId]: withZone(instance, to) },
      zones: nextZones,
    },
  });
}

export function drawCardsEffect(ctx: EffectContext, count: number): Result<EffectContext, AppError> {
  if (ctx.rng === null) {
    return err(createAppError(AppErrorCode.EffectRejected, '效果需要随机端口但本次结算未提供'));
  }
  if (!Number.isInteger(count) || count < 1) {
    return err(createAppError(AppErrorCode.EffectRejected, '抽牌数量必须是正整数', { count }));
  }
  const outcome = drawCardsFromDeck(ctx.state, ctx.rng, count);
  let next = ctx;
  if (outcome.reshuffledCount > 0) {
    next = emit(next, { type: 'DeckReshuffled', count: outcome.reshuffledCount });
  }
  if (outcome.drawn.length > 0) {
    next = emit(next, { type: 'CardsDrawn', instanceIds: outcome.drawn });
  }
  return ok({ ...next, state: outcome.state });
}

/** 推进一次随机，返回新上下文与随机值。 */
export function nextRandom(ctx: EffectContext): Result<{ ctx: EffectContext; value: number }, AppError> {
  if (ctx.rng === null) {
    return err(createAppError(AppErrorCode.EffectRejected, '效果需要随机端口但本次结算未提供'));
  }
  const roll = ctx.rng.next(ctx.state.rng);
  return ok({ ctx: { ...ctx, state: { ...ctx.state, rng: roll.state } }, value: roll.value });
}

/* ------------------------------ 一次性与嵌套 ------------------------------ */

export function hasUsed(ctx: EffectContext, instanceId: InstanceId, effectId: string): boolean {
  return ctx.usedKeys.has(effectUseKey(instanceId, effectId));
}

export function markUsed(ctx: EffectContext, instanceId: InstanceId, effectId: string): EffectContext {
  if (hasUsed(ctx, instanceId, effectId)) {
    return ctx;
  }
  const usedKeys = new Set(ctx.usedKeys);
  usedKeys.add(effectUseKey(instanceId, effectId));
  return { ...ctx, usedKeys };
}

/**
 * 撤销一次性记录。
 *
 * 「一次出战只触发一次」是默认约束，repeat_effect 是配置显式要求的例外，
 * 因此重复执行前必须撤销该技能的触发记录，否则第二次会被一次性约束静默跳过。
 */
export function forgetUse(
  ctx: EffectContext,
  instanceId: InstanceId,
  effectId: string,
): EffectContext {
  if (!hasUsed(ctx, instanceId, effectId)) {
    return ctx;
  }
  const usedKeys = new Set(ctx.usedKeys);
  usedKeys.delete(effectUseKey(instanceId, effectId));
  return { ...ctx, usedKeys };
}

/** 进入一层嵌套：调用方先用 effect-limits 校验深度与循环。 */
export function descend(ctx: EffectContext, effectId: string, sourceInstanceId?: InstanceId): EffectContext {
  return {
    ...ctx,
    depth: ctx.depth + 1,
    chain: [...ctx.chain, effectId],
    scope: {
      ...ctx.scope,
      effectId,
      sourceInstanceId: sourceInstanceId ?? ctx.scope.sourceInstanceId,
      operationIndex: 0,
    },
  };
}

export function withOperationIndex(ctx: EffectContext, operationIndex: number): EffectContext {
  return { ...ctx, scope: { ...ctx.scope, operationIndex } };
}

export function withScopeSource(ctx: EffectContext, sourceInstanceId: InstanceId): EffectContext {
  return { ...ctx, scope: { ...ctx.scope, sourceInstanceId } };
}

export function extractRngState(ctx: EffectContext): RngState {
  return ctx.state.rng;
}
