import { createConfigRegistry } from '@config/config-registry';
import { freezeVariant } from '../../lab/config-snapshot';
import { createManifest } from '../../lab/capabilities';
import { createRun } from '../../lab/runner';
import { replayAt } from '../../lab/replay';
import { decide } from '../../lab/policies/visible-damage';
import { LabEngine } from '../../lab/engine-adapter';
import { playerObservation } from '../../lab/observations';
const loaded = createConfigRegistry();
if (!loaded.ok)
    throw new Error('配置无效');
describe('自动对局与回放', () => {
    it('固定动作窗口保留真实伤害，未到终局不冒充正常败局', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, 'A');
        const e = new LabEngine(variant);
        e.dispatch({ type: 'NewRun', seed: 'window' });
        const assignments = [{ slotIndex: 0, instanceId: e.state!.zones.hand[0]! }];
        const manifest = await createManifest({ variants: [variant], policies: ['legacy_match_v1'], seeds: ['window'], mode: 'same-action', scenario: { id: 'window', source: 'seed', state: e.state! }, fixedCommands: [{ type: 'Play', assignments }] });
        const run = await createRun(manifest, variant, 'legacy_match_v1', 'window');
        await run.runToEnd();
        expect(run.record.status).toBe('completed');
        expect(run.record.outcome).toBeUndefined();
        expect(run.record.frames[0]?.events.some((v) => v.type === 'DamageResolved')).toBe(true);
    });
    it('硬超时有独立状态，不等同命令预算或战败', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, 'A');
        const manifest = await createManifest({ variants: [variant], policies: ['legacy_match_v1'], seeds: ['timeout'], budgets: { timeoutMs: 10 } });
        let now = 0;
        const run = await createRun(manifest, variant, 'legacy_match_v1', 'timeout', undefined, { clock: { now: () => now } });
        now = 11;
        await run.step();
        expect(run.record.status).toBe('timeout');
        expect(run.record.outcome).toBeUndefined();
    });
    it('旧种子保持三战通关和两次强化，并可准确重放', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, 'A');
        const manifest = await createManifest({ variants: [variant], policies: ['legacy_match_v1'], seeds: ['mvp-full-run'] });
        const run = await createRun(manifest, variant, 'legacy_match_v1', 'mvp-full-run');
        await run.runToEnd();
        expect(run.record.status).toBe('completed');
        expect(run.record.outcome).toBe('won');
        expect(run.record.frames.filter((f) => f.command.type === 'ChooseEnhancement')).toHaveLength(2);
        const replay = await replayAt(variant, run.record, run.record.frames.length);
        expect(replay).toEqual(run.record.finalState);
    });
    it('可从提交命令边界续跑，结果不重算，重复运行确定', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, 'A');
        const manifest = await createManifest({ variants: [variant], policies: ['visible_damage_v1'], seeds: ['resume'] });
        const first = await createRun(manifest, variant, 'visible_damage_v1', 'resume');
        for (let i = 0; i < 6; i++)
            await first.step();
        const resumed = await createRun(manifest, variant, 'visible_damage_v1', 'resume', first.record);
        await resumed.runToEnd();
        const repeated = await createRun(manifest, variant, 'visible_damage_v1', 'resume');
        await repeated.runToEnd();
        expect(resumed.record.frames).toEqual(repeated.record.frames);
        expect(resumed.record.finalState).toEqual(repeated.record.finalState);
    });
    it('预算超限不算战败，停止不能续跑', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, 'A');
        const manifest = await createManifest({ variants: [variant], policies: ['legacy_match_v1'], seeds: ['limited'], budgets: { commands: 1 } });
        const run = await createRun(manifest, variant, 'legacy_match_v1', 'limited');
        await run.runToEnd();
        expect(run.record.status).toBe('budget_exceeded');
        expect(run.record.outcome).toBeUndefined();
        await expect(createRun(manifest, variant, 'legacy_match_v1', 'limited', { ...run.record, status: 'cancelled' })).rejects.toThrow();
    });
    it('相同公开局面不同隐藏牌序不改变伤害策略决定', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, 'A');
        const engine = new LabEngine(variant);
        engine.dispatch({ type: 'NewRun', seed: 'private' });
        const state = engine.state!;
        const other = new LabEngine(variant, { ...state, zones: { ...state.zones, drawPile: [...state.zones.drawPile].reverse() } });
        const a = decide(playerObservation(state, engine.config), (plan, targets) => engine.preview(plan, targets));
        const b = decide(playerObservation(other.state!, other.config), (plan, targets) => other.preview(plan, targets));
        expect(a).toEqual(b);
        expect(a.evaluated).toBeLessThanOrEqual(256);
    });
});
