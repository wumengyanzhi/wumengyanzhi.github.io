import type { ConfigRegistry } from '@config/config-registry';
import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { CardDefinition } from '@domain/models/card-definition';
import { asDefinitionId, asRunNodeId, type DefinitionId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';
import { createGameState } from '@domain/state/game-state';
import { createRunState } from '@domain/state/run-state';
import { createZonesState } from '@domain/state/zones-state';
import type { BattleEvent } from '@domain/events/battle-events';
import type { RngPort } from '@domain/ports/rng-port';
import type { BattleRules } from '@domain/systems/battle-rules';
import { startBattle } from '@domain/systems/battle-setup';
import { playCards } from '@domain/commands/play-cards';
import { discardCards } from '@domain/commands/discard-cards';
import { stageCard, unstageCard } from '@domain/commands/stage-card';
import { findWeaponsNeedingTarget, selectWeaponTarget } from '@domain/commands/select-target';
import { generateEnhancementCandidates } from '@domain/commands/generate-enhancement';
import { rerollEnhancementCandidates } from '@domain/commands/reroll-enhancement';
import { chooseEnhancement } from '@domain/commands/choose-enhancement';
import { createCardInstances } from '@domain/models/card-instance-factory';
import { validateCommand, type GameCommand } from './command-validation';
import type { TracePort } from '@domain/diagnostics/trace';

/**
 * 命令分发。
 *
 * 命令到事件的唯一管道：预检 → 领域处理 → 流程推进。
 * 全有或全无：领域返回失败就原样把错误抛回，调用方拿到的 state 与调用前逐字节相同；
 * 本文件不持有可变状态，同一个 state 进来两次必然得到同一个结果。
 */

export interface DispatchResult {
  readonly state: GameState;
  readonly events: readonly BattleEvent[];
}

export interface CommandDispatcherContext {
  readonly trace?: TracePort;
  readonly registry: ConfigRegistry;
  readonly rules: BattleRules;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly rng: RngPort;
}

export interface CommandDispatcher {
  apply(state: GameState | null, command: GameCommand): Result<DispatchResult, AppError>;
}

function noEvents(state: GameState): Result<DispatchResult, AppError> {
  return ok({ state, events: [] });
}

export function createCommandDispatcher(context: CommandDispatcherContext): CommandDispatcher {
  const { registry, rules, definitions, rng } = context;

  function startConfiguredBattle(state: GameState, nodeId: string): Result<GameState, AppError> {
    const runDefinition = registry.getRunDefinition(state.run.runDefinitionId);
    const node = runDefinition?.nodes.find((entry) => entry.id === nodeId);
    const enemy = node?.type === 'battle' ? registry.getEnemyDefinition(node.contentRef) : undefined;
    if (node === undefined || enemy === undefined) {
      return err(createAppError(AppErrorCode.ConfigInvalid, '战斗节点或敌人配置不存在', { nodeId }));
    }
    return ok(startBattle({
      state: { ...state, run: { ...state.run, currentNodeId: asRunNodeId(node.id) } },
      rules,
      rng,
      definitions,
      enemyDefinitionId: asDefinitionId(enemy.id),
      enemyMaxHp: enemy.maxHp,
    }).state);
  }

  function newRun(seed: string): Result<GameState, AppError> {
    const runDefinition = [...registry.config.runs.values()][0];
    if (runDefinition === undefined) {
      return err(createAppError(AppErrorCode.ConfigInvalid, '冒险配置不存在'));
    }
    const cardIds = registry.listCardDefinitions().map((card) => asDefinitionId(card.id));
    const instances = createCardInstances(cardIds);
    const cards = Object.fromEntries(instances.map((instance) => [instance.instanceId, instance]));
    const state = createGameState({
      contentVersion: registry.config.contentVersion,
      run: createRunState(runDefinition.id, asRunNodeId(runDefinition.startNodeId), registry.config.economy.initialGold),
      zones: {
        ...createZonesState(rules.playSlotCount),
        drawPile: instances.map((instance) => instance.instanceId),
      },
      cards,
      rng: rng.createState(seed),
    });
    return startConfiguredBattle(state, runDefinition.startNodeId);
  }

  /** 战斗胜利后推进：给胜利金币、进入奖励节点并生成候选，最后一战则直接结束冒险。 */
  function advanceAfterBattle(state: GameState): Result<GameState, AppError> {
    if (state.battle?.status !== 'won') return ok(state);
    const runDefinition = registry.getRunDefinition(state.run.runDefinitionId);
    const node = runDefinition?.nodes.find((entry) => entry.id === state.run.currentNodeId);
    if (node?.type !== 'battle') {
      return err(createAppError(AppErrorCode.ConfigInvalid, '当前战斗节点不存在'));
    }
    if (node.nextNodeId === null) {
      return ok({ ...state, run: { ...state.run, status: 'won' } });
    }
    const next = runDefinition?.nodes.find((entry) => entry.id === node.nextNodeId);
    if (next?.type !== 'reward') {
      return err(createAppError(AppErrorCode.ConfigInvalid, '战后奖励节点不存在'));
    }
    const rewardState: GameState = {
      ...state,
      battle: null,
      run: {
        ...state.run,
        currentNodeId: asRunNodeId(next.id),
        gold: state.run.gold + registry.config.economy.victoryGold,
        rerollsUsed: 0,
      },
    };
    const generated = generateEnhancementCandidates({
      state: rewardState,
      stageId: next.contentRef,
      config: registry.config.enhancement,
      definitions,
      rng,
    });
    return generated.ok ? ok(generated.value.state) : generated;
  }

  /** 奖励选定后推进：进入下一个战斗节点。 */
  function afterChoosing(state: GameState): Result<GameState, AppError> {
    const runDefinition = registry.getRunDefinition(state.run.runDefinitionId);
    const node = runDefinition?.nodes.find((entry) => entry.id === state.run.currentNodeId);
    if (node?.type !== 'reward' || node.nextNodeId === null) {
      return err(createAppError(AppErrorCode.ConfigInvalid, '奖励后继节点不存在'));
    }
    return startConfiguredBattle({ ...state, run: { ...state.run, rerollsUsed: 0 } }, node.nextNodeId);
  }

  function apply(state: GameState | null, command: GameCommand): Result<DispatchResult, AppError> {
    const weaponCandidates =
      state === null
        ? []
        : findWeaponsNeedingTarget(state.zones.playSlots, state.cards, definitions);
    const preflight = validateCommand(state, command, {
      economy: registry.config.economy,
      weaponCandidates,
    });
    if (!preflight.ok) return preflight;

    if (command.type === 'NewRun') {
      const started = newRun(command.seed);
      return started.ok ? noEvents(started.value) : started;
    }
    // 预检已保证 state 非空；这里再收一次类型。
    if (state === null) {
      return err(createAppError(AppErrorCode.CommandRejected, '当前没有进行中的冒险'));
    }

    if (command.type === 'StageCard') {
      const staged = stageCard(state, command.instanceId, command.slotIndex);
      return staged.ok ? noEvents(staged.value) : staged;
    }
    if (command.type === 'UnstageCard') {
      const unstaged = unstageCard(state, command.slotIndex);
      return unstaged.ok ? noEvents(unstaged.value) : unstaged;
    }
    if (command.type === 'SelectWeaponTarget') {
      const selected = selectWeaponTarget(weaponCandidates, command.weaponInstanceId, command.targetInstanceId);
      if (!selected.ok) return selected;
      return noEvents({
        ...state,
        equipmentTargets: {
          ...state.equipmentTargets,
          [command.weaponInstanceId]: command.targetInstanceId,
        },
      });
    }
    if (command.type === 'Play') {
      const played = playCards({
        trace: context.trace,
        state,
        rules,
        rng,
        definitions,
        assignments: command.assignments,
        enhancementSkills: registry.config.enhancement.legendarySkillPool,
      });
      if (!played.ok) return played;
      const advanced = advanceAfterBattle(played.value.state);
      return advanced.ok ? ok({ state: advanced.value, events: played.value.events }) : advanced;
    }
    if (command.type === 'Discard') {
      const discarded = discardCards({ state, rules, rng, instanceIds: command.instanceIds });
      return discarded.ok ? ok({ state: discarded.value.state, events: discarded.value.events }) : discarded;
    }
    if (command.type === 'RerollEnhancement') {
      const rerolled = rerollEnhancementCandidates({
        state,
        config: registry.config.enhancement,
        economy: registry.config.economy,
        definitions,
        rng,
      });
      return rerolled.ok ? noEvents(rerolled.value.state) : rerolled;
    }
    const chosen = chooseEnhancement(state, command.candidateId);
    if (!chosen.ok) return chosen;
    const advanced = afterChoosing(chosen.value.state);
    return advanced.ok ? noEvents(advanced.value) : advanced;
  }

  return { apply };
}
