import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import { createRegistryFromConfig, type ConfigRegistry, type EffectiveConfig } from '@config/config-registry';
import type { CardDefinition } from '@domain/models/card-definition';
import type { DefinitionId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';
import type { BattleEvent } from '@domain/events/battle-events';
import type { RngPort } from '@domain/ports/rng-port';
import type { StoragePort } from '@domain/ports/storage-port';
import type { BattleRules } from '@domain/systems/battle-rules';
import { createBattleRules } from '@domain/systems/battle-rules';
import { createCardDefinition } from '@domain/models/card-definition';
import type { WeaponTargetCandidates } from '@domain/commands/select-target';
import { decodeSave, encodeSave } from '@infra/save-import-export/save-codec';
import { createExporter, type SaveExportFile } from '@infra/save-import-export/exporter';
import { createImporter, type ImportOutcome } from '@infra/save-import-export/importer';
import type { ClockPort } from '@domain/ports/clock-port';
import { createSystemClock } from '@infra/clock/system-clock';
import { createCommandDispatcher, type CommandDispatcher } from './command-dispatcher';
import { createEventQueue, type EventQueue } from './event-queue';
import {
  selectDamagePreview,
  selectHand,
  selectPlaySlots,
  selectResources,
  selectWeaponTargetCandidates,
  type DamagePreview,
  type SelectorContext,
} from './selectors';
import type { GameCommand } from './command-validation';
import type { TracePort } from '@domain/diagnostics/trace';

/**
 * 应用门面。
 *
 * 只做三件事：把命令交给分发器、把事件塞进队列、在每次成功提交后落一次自动存档。
 * 规则一律不在这一层，数值一律不在这里算——界面想看什么都得走 selectors。
 */

export const AUTOSAVE_KEY = 'three_kingdoms.autosave';
const BACKUP_KEY = 'three_kingdoms.autosave.backup';

export type { GameCommand };

export interface ControllerOutcome {
  readonly state: GameState;
  readonly events: readonly BattleEvent[];
  readonly saveError?: AppError;
}

export interface GameController {
  readonly state: GameState | null;
  dispatch(command: GameCommand): Result<ControllerOutcome, AppError>;
  resume(): Result<GameState, AppError>;
  exportSave(): Result<SaveExportFile, AppError>;
  importSave(raw: string): Result<ImportOutcome, AppError>;
  subscribe(listener: (state: GameState) => void): () => void;
  /**
   * 换掉底下的配置（开发期调参面板用）。
   *
   * 只重建由配置派生的规则、卡定义、选择器与分发器，不动 GameState——
   * 于是「立即生效」的字段在本次战斗里就能看到新数值，而牌局本身不会断。
   * 结构性字段靠这个入口是改不了的：补丁 Schema 里根本没有它们的字段。
   */
  setConfig(config: EffectiveConfig): void;
  /** 事件队列：阶段九的动画系统消费同一份事件流。 */
  readonly events: EventQueue;
  readonly selectors: SelectorContext;
  hand(): ReturnType<typeof selectHand>;
  playSlots(): ReturnType<typeof selectPlaySlots>;
  resources(): ReturnType<typeof selectResources>;
  weaponTargets(): readonly WeaponTargetCandidates[];
  previewDamage(): Result<DamagePreview, AppError>;
}

interface DerivedFromConfig {
  readonly rules: BattleRules;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly selectors: SelectorContext;
  readonly dispatcher: CommandDispatcher;
}

function buildDerived(registry: ConfigRegistry, rng: RngPort, trace?: TracePort): DerivedFromConfig {
  const rules: BattleRules = createBattleRules(registry.config);
  const definitions = new Map<DefinitionId, CardDefinition>();
  for (const card of registry.listCardDefinitions()) {
    const definition = createCardDefinition(card);
    definitions.set(definition.id, definition);
  }
  return {
    rules,
    definitions,
    selectors: {
      definitions,
      rules,
      rng,
      enhancementSkills: registry.config.enhancement.legendarySkillPool,
    },
    dispatcher: createCommandDispatcher({ registry, rules, definitions, rng, trace }),
  };
}

export interface GameControllerOptions {
  readonly trace?: TracePort;
  readonly registry: ConfigRegistry;
  readonly storage: StoragePort;
  readonly rng: RngPort;
  readonly initialState?: GameState;
  /** 只用于导出文件名的时间戳；测试里给固定时钟可以让文件名可断言。 */
  readonly clock?: ClockPort;
}

export function createGameController(options: GameControllerOptions): GameController {
  const { storage, rng, clock = createSystemClock() } = options;
  let registry: ConfigRegistry = options.registry;

  /** 由配置派生的三件套；换配置时整体重建，GameState 不受影响。 */
  let derived: DerivedFromConfig = buildDerived(registry, rng, options.trace);

  const queue: EventQueue = createEventQueue();
  const exporter = createExporter({ clock });
  const importer = createImporter({
    registry,
    storage,
    saveKey: AUTOSAVE_KEY,
    backupKey: BACKUP_KEY,
  });

  let current: GameState | null = options.initialState ?? null;
  const listeners = new Set<(state: GameState) => void>();
  const notify = (state: GameState): void => {
    for (const listener of listeners) listener(state);
  };

  function withState<T>(read: (state: GameState) => T, fallback: T): T {
    return current === null ? fallback : read(current);
  }

  return {
    get state() {
      return current;
    },
    events: queue,
    get selectors() {
      return derived.selectors;
    },
    setConfig(config) {
      registry = createRegistryFromConfig(config);
      derived = buildDerived(registry, rng, options.trace);
      // 状态对象没换，订阅者的 setState 会被 React 判为同一个引用而跳过，
      // 所以调参面板自己会再抬一次版本号触发重渲染；这里仍然通知一次，保持语义一致。
      if (current !== null) notify(current);
    },
    dispatch(command) {
      const result = derived.dispatcher.apply(current, command);
      if (!result.ok) return result;
      current = result.value.state;
      queue.push(result.value.events);
      const saved = storage.write(AUTOSAVE_KEY, encodeSave(current));
      notify(current);
      return ok({
        state: current,
        events: result.value.events,
        ...(!saved.ok ? { saveError: saved.error } : {}),
      });
    },
    resume() {
      const raw = storage.read(AUTOSAVE_KEY);
      if (raw === null) return err(createAppError(AppErrorCode.SaveRejected, '没有可继续的存档'));
      const decoded = decodeSave(raw, registry);
      if (!decoded.ok) return err(decoded.error);
      current = decoded.value.state;
      queue.clear();
      notify(current);
      return ok(current);
    },
    exportSave() {
      return current === null
        ? err(createAppError(AppErrorCode.CommandRejected, '当前没有可导出的冒险'))
        : exporter.build(current);
    },
    importSave(raw) {
      const outcome = importer.run(raw);
      if (!outcome.ok) return outcome;
      current = outcome.value.state;
      queue.clear();
      notify(current);
      return outcome;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hand() {
      return withState((state) => selectHand(state, derived.selectors), []);
    },
    playSlots() {
      return withState((state) => selectPlaySlots(state, derived.selectors), []);
    },
    resources() {
      return withState(
        (state) => selectResources(state, derived.selectors),
        {
          playCountRemaining: 0,
          discardCountRemaining: 0,
          handSize: 0,
          handLimit: derived.rules.handLimit,
          gold: 0,
        },
      );
    },
    weaponTargets() {
      return withState((state) => selectWeaponTargetCandidates(state, derived.selectors), []);
    },
    previewDamage() {
      return current === null
        ? err(createAppError(AppErrorCode.CommandRejected, '当前没有进行中的冒险'))
        : selectDamagePreview(current, derived.selectors);
    },
  };
}
