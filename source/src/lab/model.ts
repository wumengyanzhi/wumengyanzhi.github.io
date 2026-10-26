import type { EffectiveConfig } from '@config/config-registry';
import type { RuntimePatch } from '@config/runtime-patch';
import type { GameCommand } from '@app/game-controller';
import type { GameState } from '@domain/state/game-state';
import type { BattleEvent } from '@domain/events/battle-events';
export const ENGINE_VERSION = 'legacy_mvp.trace.2';
export const RNG_VERSION = 'legacy_rng_v1';
export const POLICY_IDS = ['legacy_match_v1', 'visible_damage_v1'] as const;
export type PolicyId = typeof POLICY_IDS[number];
export type ConfigSnapshot = Omit<EffectiveConfig, 'cards' | 'enemies' | 'runs'> & {
    readonly cards: readonly (EffectiveConfig['cards'] extends ReadonlyMap<string, infer T> ? T : never)[];
    readonly enemies: readonly (EffectiveConfig['enemies'] extends ReadonlyMap<string, infer T> ? T : never)[];
    readonly runs: readonly (EffectiveConfig['runs'] extends ReadonlyMap<string, infer T> ? T : never)[];
};
export interface FrozenVariant {
    readonly id: string;
    readonly name: string;
    readonly hash: string;
    readonly patch: RuntimePatch;
    readonly config: ConfigSnapshot;
}
export interface Scenario {
    readonly id: string;
    readonly source: 'seed' | 'replay' | 'fixture' | 'save';
    readonly state: GameState;
    readonly parent?: string;
    readonly note?: string;
}
export interface ExperimentManifest {
    readonly id: string;
    readonly name: string;
    readonly ruleset: 'legacy_mvp';
    readonly engineVersion: string;
    readonly rngVersion: string;
    readonly mode: 'whole-run' | 'battle' | 'same-action';
    readonly variants: readonly FrozenVariant[];
    readonly policies: readonly PolicyId[];
    readonly seeds: readonly string[];
    readonly split: 'exploration' | 'holdout';
    readonly plannedRuns: number;
    readonly scenario?: Scenario;
    readonly fixedCommands?: readonly GameCommand[];
    readonly budgets: {
        readonly commands: number;
        readonly evaluations: number;
        readonly timeoutMs: number;
        readonly storageBytes: number;
    };
    readonly bootstrapSeed: string;
}
export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'error' | 'budget_exceeded' | 'timeout' | 'cancelled';
import type { TraceStep } from '@domain/diagnostics/trace';
export type { TraceStep } from '@domain/diagnostics/trace';
export interface DecisionRecord {
    readonly policy: PolicyId;
    readonly reason: string;
    readonly evaluated: number;
    readonly truncated: boolean;
    readonly commands: readonly GameCommand[];
}
export interface RunFrame {
    readonly command: GameCommand;
    readonly beforeHash: string;
    readonly afterHash: string;
    readonly events: readonly BattleEvent[];
    readonly trace: readonly TraceStep[];
    readonly decision?: DecisionRecord;
    readonly battleIndex: number;
    readonly enemyHpBefore: number | null;
    readonly goldBefore: number;
    readonly goldAfter: number;
    readonly rngBefore: number;
    readonly rngAfter: number;
}
export interface Checkpoint {
    readonly afterFrames: number;
    readonly state: GameState;
    readonly hash: string;
}
export interface RunRecord {
    readonly key: string;
    readonly fingerprint: string;
    readonly variantId: string;
    readonly policy: PolicyId;
    readonly seed: string;
    readonly attemptId: number;
    readonly status: RunStatus;
    readonly outcome?: 'won' | 'lost';
    readonly reason?: string;
    readonly quality: 'complete' | 'trace_incomplete';
    readonly frames: readonly RunFrame[];
    readonly checkpoints: readonly Checkpoint[];
    readonly pendingCommands: readonly GameCommand[];
    readonly evaluations: number;
    readonly finalState?: GameState;
}
export interface BatchSnapshot {
    readonly manifest: ExperimentManifest;
    readonly status: 'running' | 'paused' | 'stopped' | 'completed';
    readonly records: readonly RunRecord[];
}
