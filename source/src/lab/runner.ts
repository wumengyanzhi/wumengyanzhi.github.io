import type { GameState } from '@domain/state/game-state';
import { createSystemClock } from '@infra/clock/system-clock';
import type { ClockPort } from '@domain/ports/clock-port';
import { clone, fingerprint } from './config-snapshot';
import { LabEngine } from './engine-adapter';
import { playerObservation } from './observations';
import { legacyDecide } from './policies/legacy-match';
import { decide } from './policies/visible-damage';
import { ENGINE_VERSION, type ExperimentManifest, type FrozenVariant, type PolicyId, type RunRecord, type RunFrame } from './model';
export async function createRun(manifest: ExperimentManifest, variant: FrozenVariant, policy: PolicyId, seed: string, previous?: RunRecord, options: {
    clock?: ClockPort;
} = {}) {
    if (manifest.engineVersion !== ENGINE_VERSION)
        throw new Error('引擎版本未接入');
    if (previous && !['running', 'paused', 'pending'].includes(previous.status))
        throw new Error('该任务为终态，不能续跑');
    let initial = manifest.scenario?.state;
    if (initial && manifest.mode === 'battle') {
        if (!initial.battle || initial.battle.completedPlays !== 0 || initial.zones.playSlots.some((id) => id !== null))
            throw new Error('需要未出战的战前检查点');
        const enemy = variant.config.enemies.find((e) => e.id === initial!.battle!.enemyDefinitionId);
        if (!enemy)
            throw new Error('敌人未接入');
        initial = { ...initial, battle: { ...initial.battle, enemyMaxHp: enemy.maxHp, enemyCurrentHp: enemy.maxHp } };
    }
    const identity = await fingerprint({ engine: manifest.engineVersion, rng: manifest.rngVersion, config: variant.hash, policy, seed, mode: manifest.mode, initial, fixed: manifest.fixedCommands, budgets: manifest.budgets });
    if (previous && previous.fingerprint !== identity)
        throw new Error('续跑清单身份不一致');
    const engine = new LabEngine(variant, previous?.finalState ?? initial);
    const clock = options.clock ?? createSystemClock();
    const started = clock.now();
    let record: RunRecord = previous ? clone({ ...previous, status: 'running' }) : { key: identity, fingerprint: identity, variantId: variant.id, policy, seed, attemptId: 1, status: 'running', quality: 'complete', frames: [], checkpoints: [], pendingCommands: manifest.mode === 'same-action' ? [...(manifest.fixedCommands ?? [])] : engine.state ? [] : [{ type: 'NewRun', seed }], evaluations: 0, finalState: engine.state ?? undefined };
    if (engine.state && !record.checkpoints.length)
        record = { ...record, checkpoints: [{ afterFrames: 0, state: clone(engine.state), hash: await fingerprint(engine.state) }] };
    async function step(): Promise<boolean> {
        if (record.status !== 'running')
            return false;
        const state = engine.state;
        if (state && state.run.status !== 'running') {
            record = { ...record, status: 'completed', outcome: state.run.status, finalState: state };
            return false;
        }
        if (record.frames.length >= manifest.budgets.commands) {
            record = { ...record, status: 'budget_exceeded', reason: '命令预算耗尽' };
            return false;
        }
        if (clock.now() - started > manifest.budgets.timeoutMs) {
            record = { ...record, status: 'timeout', reason: '调度保护超时' };
            return false;
        }
        try {
            let decision;
            if (!record.pendingCommands.length) {
                if (manifest.mode === 'same-action') {
                    const last=record.frames.at(-1)?.events??[];
                    record = { ...record, status: 'completed', outcome: last.some((e)=>e.type==='BattleWon')?'won':last.some((e)=>e.type==='BattleLost')?'lost':undefined, reason: '指定动作窗口结束；未到终局时只报告窗口伤害', finalState: state ?? undefined };
                    return false;
                }
                if (!state)
                    throw new Error('状态缺失');
                const observation = playerObservation(state, engine.config);
                decision = policy === 'legacy_match_v1' ? legacyDecide(observation) : decide(observation, (plan, targets) => engine.preview(plan, targets));
                if (record.evaluations + decision.evaluated > manifest.budgets.evaluations) {
                    record = { ...record, status: 'budget_exceeded', reason: '候选评价预算耗尽' };
                    return false;
                }
                record = { ...record, pendingCommands: decision.commands, evaluations: record.evaluations + decision.evaluated };
            }
            const command = record.pendingCommands[0]!;
            const beforeHash = await fingerprint(state);
            const output = engine.dispatch(command);
            const afterHash = await fingerprint(output.state);
            const frame: RunFrame = { command, beforeHash, afterHash, events: output.events, trace: output.trace, decision, battleIndex: (state?.run.battlesWon ?? 0) + 1, enemyHpBefore: state?.battle?.enemyCurrentHp ?? null, goldBefore: state?.run.gold ?? engine.config.economy.initialGold, goldAfter: output.state.run.gold, rngBefore: state?.rng.cursor ?? 0, rngAfter: output.state.rng.cursor };
            const frames = [...record.frames, frame];
            const transition = command.type === 'NewRun' || command.type === 'ChooseEnhancement' || output.events.some((e) => e.type === 'BattleWon' || e.type === 'BattleLost') || frames.length % 10 === 0;
            record = { ...record, frames, pendingCommands: record.pendingCommands.slice(1), finalState: output.state, quality: engine.incomplete ? 'trace_incomplete' : 'complete', checkpoints: transition ? [...record.checkpoints, { afterFrames: frames.length, state: clone(output.state), hash: afterHash }] : record.checkpoints };
            if (manifest.mode === 'battle' && output.events.some((e) => e.type === 'BattleWon' || e.type === 'BattleLost'))
                record = { ...record, status: 'completed', outcome: output.events.some((e) => e.type === 'BattleWon') ? 'won' : 'lost' };
            return record.status === 'running';
        }
        catch (error) {
            record = { ...record, status: 'error', reason: error instanceof Error ? error.message : String(error) };
            return false;
        }
    }
    return { get record() { return record; }, step, async runToEnd() { while (await step()) { /* 每步是完整提交 */ } }, pause() { record = { ...record, status: record.status === 'running' ? 'paused' : record.status }; }, cancel() { if (record.status === 'running' || record.status === 'paused')
            record = { ...record, status: 'cancelled', outcome: undefined, reason: '用户停止' }; } };
}
export type RunSession = Awaited<ReturnType<typeof createRun>>;
export function battleState(state: GameState | null) { return state?.battle ?? null; }
