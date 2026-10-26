import type {
  EffectCondition,
  EffectConfig,
  EffectOperation,
  EffectOperationType,
} from '@config/schemas/effect.schema';
import type { EnhancementBalance } from '@config/schemas/balance.schema';
import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { RngPort } from '../ports/rng-port';
import type { CardDefinition } from '../models/card-definition';
import {
  addThisPlayStats,
  markEnhancementSkillUsed,
  type CardInstance,
} from '../models/card-instance';
import type { DefinitionId, InstanceId } from '../models/ids';
import type { EffectTiming } from '../models/enums';
import type { BattleEvent } from '../events/battle-events';
import type { GameState } from '../state/game-state';
import type { PlaySnapshot } from '../systems/play-snapshot';
import type { EquipBinding } from '../systems/weapon-matching';
import {
  addGold,
  createEffectContext,
  emit,
  hasUsed,
  markUsed,
  patchInstance,
  readDefinition,
  withOperationIndex,
  type EffectContext,
} from './effect-context';
import { EFFECT_HANDLERS, type EffectHandler } from './handlers/index';
import { emitTrace, type TracePort, type TraceStep } from '../diagnostics/trace';

/**
 * 效果注册表。
 *
 * 配置只给出「时机 + 条件 + 操作」，这里把操作类型映射到处理器。
 * 未知类型不会走到这里：zod 在配置校验阶段就拒绝了它们，运行期拿不到未知类型。
 *
 * 结算顺序固定：按快照从左到右逐个实体，同一实体内按 effects 的书写顺序，
 * 同一效果内按 operations 的书写顺序。结算期间任何一步被拒，该实体的改动整体回滚。
 */

const HANDLER_BY_TYPE: ReadonlyMap<EffectOperationType, EffectHandler> = new Map(
  EFFECT_HANDLERS.map((handler) => [handler.type, handler]),
);

/** 注册表已知的操作类型，供配置层与测试比对，防止两边漂移。 */
export const KNOWN_EFFECT_OPERATION_TYPES: readonly EffectOperationType[] = EFFECT_HANDLERS.map(
  (handler) => handler.type,
);

export function getEffectHandler(type: EffectOperationType): EffectHandler | null {
  return HANDLER_BY_TYPE.get(type) ?? null;
}

export interface ResolveEffectsInput {
  readonly trace?: TracePort;
  readonly state: GameState;
  readonly snapshot: PlaySnapshot;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly bindings: readonly EquipBinding[];
  readonly timing: EffectTiming;
  readonly enhancementSkills: EnhancementBalance['legendarySkillPool'];
  readonly rng?: RngPort | null;
}

export interface EffectResolution {
  readonly state: GameState;
  readonly zonePower: number;
  readonly zoneAmp: number;
  readonly events: readonly BattleEvent[];
  /** 被约束拦下的结算；对应实体的改动已回滚。 */
  readonly rejections: readonly AppError[];
}

/* ------------------------------ 条件 ------------------------------ */

function conditionMatches(condition: EffectCondition, ctx: EffectContext): boolean {
  const { snapshot, bindings } = ctx;
  const source = ctx.scope.sourceInstanceId;
  switch (condition.type) {
    case 'always':
      return true;
    case 'self_equipped_weapon_relation':
      return bindings.some(
        (binding) =>
          binding.targetInstanceId === source && binding.relation === condition.relation,
      );
    case 'self_adjacent_both': {
      const index = snapshot.slots.findIndex((entry) => entry === source);
      if (index < 0) return false;
      const left = snapshot.slots[index - 1];
      const right = snapshot.slots[index + 1];
      if (left === null || left === undefined || right === null || right === undefined) {
        return false;
      }
      return (
        readDefinition(ctx, left)?.cardType === condition.cardType &&
        readDefinition(ctx, right)?.cardType === condition.cardType
      );
    }
    case 'play_contains_card_type':
      return (
        snapshot.participantIds.filter(
          (instanceId) => readDefinition(ctx, instanceId)?.cardType === condition.cardType,
        ).length >= condition.min
      );
    case 'play_contains_distinct_card_types':
      return (
        new Set(
          snapshot.participantIds
            .map((instanceId) => readDefinition(ctx, instanceId)?.cardType)
            .filter((cardType): cardType is NonNullable<typeof cardType> => cardType !== undefined),
        ).size >= condition.min
      );
    case 'discarded_this_battle':
      return snapshot.battle.hasDiscardedThisBattle && condition.min <= 1;
  }
}

/* ------------------------------ 单个效果 ------------------------------ */

export function applyEffect(
  ctx: EffectContext,
  effect: EffectConfig,
): Result<EffectContext, AppError> {
  const source = ctx.scope.sourceInstanceId;
  if (effect.timing !== ctx.scope.timing) {
    return ok(ctx);
  }
  if (!conditionMatches(effect.condition, ctx)) {
    emitTrace(ctx.trace, { kind: 'condition', source, label: effect.effectId, timing: ctx.scope.timing, detail: '条件不满足' });
    return ok(ctx);
  }
  // 同一实体同一技能在一次出战中只触发一次；重复触发只能来自显式的 repeat_effect。
  if (hasUsed(ctx, source, effect.effectId)) {
    emitTrace(ctx.trace, { kind: 'condition', source, label: effect.effectId, timing: ctx.scope.timing, detail: '本次调用已使用' });
    return ok(ctx);
  }
  let working = { ...markUsed(ctx, source, effect.effectId), diagnosticEffectId: effect.effectId };

  for (let index = 0; index < effect.operations.length; index += 1) {
    const operation: EffectOperation = effect.operations[index] as EffectOperation;
    const handler = getEffectHandler(operation.type);
    if (handler === null) {
      return err(
        createAppError(AppErrorCode.EffectRejected, '没有对应的效果处理器', {
          type: operation.type,
          effectId: effect.effectId,
        }),
      );
    }
    const applied = handler.apply(withOperationIndex(working, index), operation);
    if (!applied.ok) {
      return applied;
    }
    working = { ...applied.value, diagnosticEffectId: effect.effectId };
  }

  emitTrace(ctx.trace, { kind: 'condition', source, label: effect.effectId, timing: ctx.scope.timing, detail: '合法效果已提交' });
  return ok(emit(working, { type: 'EffectResolved', sourceInstanceId: source, effectId: effect.effectId }));
}

/* ------------------------------ 战后强化附加技能 ------------------------------ */

type EnhancementSkill = EnhancementBalance['legendarySkillPool'][number];

function applyEnhancementSkills(
  ctx: EffectContext,
  sourceInstanceId: InstanceId,
  skills: readonly EnhancementSkill[],
): Result<EffectContext, AppError> {
  const definition = readDefinition(ctx, sourceInstanceId);
  const instance = ctx.state.cards[sourceInstanceId];
  if (definition === undefined || instance === undefined) {
    return ok(ctx);
  }
  let working = ctx;
  let current: CardInstance = instance;

  for (const skill of skills) {
    if (!current.enhancementSkillIds.includes(skill.id)) continue;
    working={...working,diagnosticEffectId:skill.id};
    const unused = !current.usedEnhancementSkillIdsThisBattle.includes(skill.id);
    const kind = skill.effect.kind;
    let updated = current;

    if (working.scope.timing === 'on_play') {
      if (kind === 'first_play_power' && unused) {
        updated = markEnhancementSkillUsed(addThisPlayStats(current, skill.effect.value, 0), skill.id);
      } else if (kind === 'first_play_amp' && unused) {
        updated = markEnhancementSkillUsed(addThisPlayStats(current, 0, skill.effect.value), skill.id);
      } else if (kind === 'same_type_power' || kind === 'unique_type_amp') {
        const hasPeer = working.snapshot.participantIds.some((id) => {
          if (id === sourceInstanceId) return false;
          const peer = working.state.cards[id];
          if (peer === undefined) return false;
          return working.definitions.get(peer.definitionId)?.cardType === definition.cardType;
        });
        if (kind === 'same_type_power' && hasPeer) {
          updated = addThisPlayStats(current, skill.effect.value, 0);
        } else if (kind === 'unique_type_amp' && !hasPeer) {
          updated = addThisPlayStats(current, 0, skill.effect.value);
        }
      } else if (kind === 'repeat_original' && unused) {
        updated = markEnhancementSkillUsed(current, skill.id);
      }
    } else if (kind === 'once_after_resolve_gold' && unused) {
      working = emit(addGold(working, skill.effect.value), {
        type: 'GoldGained',
        amount: skill.effect.value,
      });
      updated = markEnhancementSkillUsed(current, skill.id);
    }

    if (updated !== current) {
      const patched = patchInstance(working, sourceInstanceId, () => updated);
      if (!patched.ok) {
        return patched;
      }
      working = emit(patched.value, {
        type: 'EffectResolved',
        sourceInstanceId,
        effectId: skill.id,
      });
      current = updated;
    }
  }

  return ok(working);
}

/* ------------------------------ 整轮结算 ------------------------------ */

export function resolveEffects(input: ResolveEffectsInput): EffectResolution {
  let state = input.state;
  let zonePower = 0;
  let zoneAmp = 0;
  let events: BattleEvent[] = [];
  const rejections: AppError[] = [];

  for (const sourceInstanceId of input.snapshot.participantIds) {
    const definition = readDefinitionSafe(state, input.definitions, sourceInstanceId);
    if (definition === undefined) continue;

    // 检查点：被拒时整体回滚该实体引入的改动。
    const checkpoint = { state, events: events.slice(), zonePower, zoneAmp };
    const buffered: TraceStep[] = [];

    let ctx = createEffectContext({
      trace: input.trace ? { write: (step) => buffered.push(step), onError: input.trace.onError } : undefined,
      state,
      snapshot: input.snapshot,
      definitions: input.definitions,
      bindings: input.bindings,
      rng: input.rng ?? null,
      resolveEffect: applyEffect,
      scope: {
        timing: input.timing,
        sourceInstanceId,
        effectId: '',
        operationIndex: 0,
      },
      events,
      zonePower,
      zoneAmp,
    });

    const echoTimes = enhancementEchoTimes(state, input.enhancementSkills, sourceInstanceId, input.snapshot);
    let failed: AppError | null = null;

    for (const effect of definition.effects) {
      if (effect.timing !== input.timing) continue;
      // 附加技能「重复原效果」：把整条效果多跑若干次，次数来自配置。
      for (let round = 0; round <= echoTimes; round += 1) {
        if (round > 0) {
          ctx = { ...ctx, usedKeys: withoutKey(ctx.usedKeys, sourceInstanceId, effect.effectId) };
        }
        const applied = applyEffect(ctx, effect);
        if (!applied.ok) {
          failed = applied.error;
          break;
        }
        ctx = applied.value;
      }
      if (failed !== null) break;
    }

    if (failed === null) {
      const skills = applyEnhancementSkills(ctx, sourceInstanceId, input.enhancementSkills);
      if (!skills.ok) {
        failed = skills.error;
      } else {
        ctx = skills.value;
      }
    }

    if (failed !== null) {
      emitTrace(input.trace, { kind: 'rejection', source: sourceInstanceId, label: definition.name, timing: input.timing, detail: failed.message });
      rejections.push(failed);
      state = checkpoint.state;
      events = checkpoint.events;
      zonePower = checkpoint.zonePower;
      zoneAmp = checkpoint.zoneAmp;
      continue;
    }

    state = ctx.state;
    for (const step of buffered) emitTrace(input.trace, step);
    zonePower = ctx.zonePower;
    zoneAmp = ctx.zoneAmp;
    events = [...ctx.events];
  }

  return { state, zonePower, zoneAmp, events, rejections };
}

function readDefinitionSafe(
  state: GameState,
  definitions: ReadonlyMap<DefinitionId, CardDefinition>,
  instanceId: InstanceId,
): CardDefinition | undefined {
  const instance = state.cards[instanceId];
  return instance === undefined ? undefined : definitions.get(instance.definitionId);
}

function enhancementEchoTimes(
  state: GameState,
  skills: readonly EnhancementSkill[],
  sourceInstanceId: InstanceId,
  snapshot: PlaySnapshot,
): number {
  const instance = state.cards[sourceInstanceId];
  if (instance === undefined) return 0;
  const echo = skills.find(
    (skill) =>
      skill.effect.kind === 'repeat_original' &&
      instance.enhancementSkillIds.includes(skill.id) &&
      !snapshot.cards[sourceInstanceId]?.usedEnhancementSkillIdsThisBattle.includes(skill.id),
  );
  return echo === undefined ? 0 : echo.effect.value;
}

function withoutKey(keys: ReadonlySet<string>, instanceId: InstanceId, effectId: string): ReadonlySet<string> {
  const next = new Set(keys);
  next.delete(`${instanceId}::${effectId}`);
  return next;
}
