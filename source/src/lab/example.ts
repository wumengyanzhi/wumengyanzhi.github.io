import { createConfigRegistry } from '@config/config-registry';
import { createSystemClock } from '@infra/clock/system-clock';
import { freezeVariant, canonical } from './config-snapshot';
import { createManifest } from './capabilities';
import { BatchRunner } from './batch';
import { aggregate, pairedComparison } from './metrics';
import { replayAt } from './replay';
import { encodeExperiment, reportCsv, reportMarkdown } from './export';
export async function runExample(split: 'exploration' | 'holdout', count = 100) {
    const loaded = createConfigRegistry();
    if (!loaded.ok)
        throw new Error('原型配置无效');
    const a = await freezeVariant(loaded.value.config, {}, 'A · 首领 3600');
    const b = await freezeVariant(loaded.value.config, { enemyStats: { 'three_kingdoms.enemy.hu_lao_mo_jiang': { maxHp: 3200 } } }, 'B · 首领 3200');
    const manifest = await createManifest({ name: `首领生命对照 · ${split}`, variants: [a, b], policies: ['legacy_match_v1', 'visible_damage_v1'], seeds: Array.from({ length: count }, (_, i) => `lab-${split}-${String(i).padStart(4, '0')}`), split });
    const runner = new BatchRunner(manifest), clock = createSystemClock(), started = clock.now();
    await runner.run(() => { }, async () => { });
    const snapshot = runner.snapshot;
    const report = aggregate(manifest, snapshot.records);
    if (report.normal !== manifest.plannedRuns)
        throw new Error(`实际样本未完整完成：${JSON.stringify(report.statusCounts)}`);
    let replayChecks = 0;
    for (const variant of manifest.variants)
        for (const policy of manifest.policies) {
            const group = snapshot.records.filter((r) => r.variantId === variant.id && r.policy === policy);
            const chosen = [group.find((r) => r.outcome === 'won'), group.find((r) => r.outcome === 'lost')].filter((r) => r !== undefined);
            for (const record of chosen) {
                const replayed = await replayAt(variant, { ...record, checkpoints: [] }, record.frames.length);
                if (canonical(replayed) !== canonical(record.finalState))
                    throw new Error('从开局完整重放不一致');
                replayChecks++;
            }
        }
    const cells = manifest.variants.flatMap((variant) => manifest.policies.map((policy) => {
        const records = snapshot.records.filter((r) => r.variantId === variant.id && r.policy === policy);
        const result = aggregate({ ...manifest, variants: [variant], policies: [policy], plannedRuns: count }, records);
        return { variant: variant.name, policy, normal: result.normal, won: result.won, lost: result.lost, winRate: result.winRate, interval: result.interval, stages: result.stages.map((s) => ({ index: s.index, reached: s.reached, won: s.won, lost: s.lost, reachedRate: s.reachedRate, conditional: s.conditional, cumulative: s.cumulative })) };
    }));
    const comparisons = manifest.policies.map((policy) => { const paired = pairedComparison(manifest, snapshot.records, policy); return { policy, pairs: paired.pairs, missing: paired.missing, delta: paired.delta, interval: paired.interval }; });
    const summary = { engine: manifest.engineVersion, split, planned: manifest.plannedRuns, statusCounts: report.statusCounts, durationMs: clock.now() - started, replayChecks, cells, comparisons };
    const detail = cells.map((c) => `\n## ${c.variant} / ${c.policy}\n\n正常 ${c.normal} 局；胜 ${c.won}、负 ${c.lost}；通关率 ${((c.winRate ?? 0) * 100).toFixed(1)}%。95% Wilson 区间：${c.interval?.map((v) => (v * 100).toFixed(1) + '%').join('–')}。\n`).join('');
    return { summary, pack: await encodeExperiment(snapshot), csv: reportCsv(snapshot), markdown: reportMarkdown(snapshot) + detail + `\n机器执行耗时 ${summary.durationMs}ms；从开局完整回放校验 ${replayChecks} 局。该耗时不代表真人局长。\n` };
}
