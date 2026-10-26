import { clone, deepFreeze, fingerprint, restoreConfig } from './config-snapshot';
import { ENGINE_VERSION, RNG_VERSION, POLICY_IDS, type ExperimentManifest, type FrozenVariant, type PolicyId, type Scenario } from './model';
import type { GameCommand } from '@app/game-controller';
import { LabEngine } from './engine-adapter';
export const CAPABILITIES = { ruleset: 'legacy_mvp', cards: 20, battles: 3, decks: 1, charms: false, market: false, leader: false } as const;
export async function createManifest(input: {
    variants: readonly FrozenVariant[];
    policies: readonly PolicyId[];
    seeds: readonly string[];
    name?: string;
    ruleset?: string;
    mode?: ExperimentManifest['mode'];
    split?: ExperimentManifest['split'];
    scenario?: Scenario;
    fixedCommands?: readonly GameCommand[];
    budgets?: Partial<ExperimentManifest['budgets']>;
}): Promise<ExperimentManifest> {
    if (input.ruleset && input.ruleset !== 'legacy_mvp')
        throw new Error('六战 V2 规则未接入');
    if (!input.variants.length || !input.policies.length || input.policies.some((p) => !POLICY_IDS.includes(p)))
        throw new Error('请选择已支持的方案与策略');
    if (new Set(input.variants.map((v) => v.id)).size !== input.variants.length)
        throw new Error('请移除完全相同的重复方案');
    for (const v of input.variants) {
        restoreConfig(v.config);
        if (await fingerprint(v.config) !== v.hash || v.id !== v.hash)
            throw new Error('方案指纹不一致');
    }
    const seeds = [...new Set(input.seeds.map((s) => s.trim()).filter(Boolean))];
    const policies = [...new Set(input.policies)];
    const plannedRuns = seeds.length * policies.length * input.variants.length;
    if (!plannedRuns || plannedRuns > 20000)
        throw new Error('任务必须为 1–20,000 局');
    const mode = input.mode ?? 'whole-run';
    if (mode !== 'whole-run' && !input.scenario)
        throw new Error('局部实验需要合法检查点');
    if (mode !== 'whole-run' && (seeds.length !== 1 || seeds[0] !== input.scenario?.state.rng.seed))
        throw new Error('固定局面须使用其原种子，不能把同一检查点重复当作独立样本');
    if (mode === 'same-action' && !input.fixedCommands?.length)
        throw new Error('同动作实验需要明确命令');
    if(mode==='same-action'&&(input.fixedCommands?.at(-1)?.type!=='Play'||input.fixedCommands.filter((c)=>c.type==='Play').length!==1||input.fixedCommands.some((c)=>!['StageCard','UnstageCard','SelectWeaponTarget','Play'].includes(c.type))))throw new Error('固定动作窗口必须以唯一一次出战结束');
    if (mode === 'whole-run' && input.scenario)
        throw new Error('整局实验须从全新开局运行');
    if (input.scenario) {
        const state = input.scenario.state;
        if (mode === 'battle' && (!state.battle || state.battle.status !== 'in_progress' || state.battle.completedPlays !== 0 || state.zones.playSlots.some((id) => id !== null)))
            throw new Error('需要尚未出战且格位为空的战前检查点');
        for (const variant of input.variants) {
            const probe = new LabEngine(variant, state);
            if (mode === 'same-action')
                for (const command of input.fixedCommands ?? [])
                    probe.dispatch(command);
        }
    }
    const budgets = { commands: 2000, evaluations: 100000, timeoutMs: 60000, storageBytes: 200 * 1024 * 1024, ...input.budgets };
    if(Object.keys(budgets).some((key)=>!['commands','evaluations','timeoutMs','storageBytes'].includes(key)))throw new Error('执行预算包含未知字段');
    if (Object.values(budgets).some((v) => !Number.isSafeInteger(v) || v <= 0))
        throw new Error('预算必须为正整数');
    return deepFreeze(clone({ id: crypto.randomUUID(), name: input.name?.trim() || '三战参数实验', ruleset: 'legacy_mvp', engineVersion: ENGINE_VERSION, rngVersion: RNG_VERSION, mode, variants: input.variants, policies, seeds, split: input.split ?? 'exploration', plannedRuns, scenario: input.scenario, fixedCommands: input.fixedCommands, budgets, bootstrapSeed: 'lab-bootstrap-v1' } satisfies ExperimentManifest));
}
