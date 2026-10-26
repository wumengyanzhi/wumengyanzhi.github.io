import { pairedBootstrap, quantile, wilson } from './statistics';
import type { ExperimentManifest, RunRecord, RunStatus } from './model';
export function deduplicate(records: readonly RunRecord[]): RunRecord[] {
    const map = new Map<string, RunRecord>();
    for (const r of records) {
        const old = map.get(r.fingerprint);
        if (!old || r.attemptId >= old.attemptId)
            map.set(r.fingerprint, r);
    }
    return [...map.values()];
}
export function aggregate(manifest: ExperimentManifest, raw: readonly RunRecord[]) {
    const records = deduplicate(raw);
    const statusCounts: Record<RunStatus, number> = { pending: 0, running: 0, paused: 0, completed: 0, error: 0, budget_exceeded: 0, timeout: 0, cancelled: 0 };
    records.forEach((r) => statusCounts[r.status]++);
    const normal = records.filter((r) => r.status === 'completed' && r.outcome !== undefined);
    const won = normal.filter((r) => r.outcome === 'won').length;
    const stages = [1, 2, 3].map((index) => {
        const reached = normal.filter((r) => r.frames.some((f) => f.battleIndex === index && f.command.type === 'Play'));
        const wins = reached.filter((r) => r.frames.some((f) => f.battleIndex === index && f.events.some((e) => e.type === 'BattleWon')));
        const loses = reached.filter((r) => r.frames.some((f) => f.battleIndex === index && f.events.some((e) => e.type === 'BattleLost')));
        return { index, reached: reached.length, won: wins.length, lost: loses.length, reachedRate: normal.length ? reached.length / normal.length : null, conditional: reached.length ? wins.length / reached.length : null, cumulative: normal.length ? wins.length / normal.length : null, keys: reached.map((r) => r.key) };
    });
    const damagePool = manifest.mode === 'same-action' ? records.filter((r) => r.status === 'completed') : normal;
    const damages = damagePool.flatMap((r) => r.frames.flatMap((f) => f.events.filter((e) => e.type === 'DamageResolved').map((e) => e.type === 'DamageResolved' ? { key: r.key, stage: f.battleIndex, damage: e.amount, power: e.powerTotal, amp: e.ampTotal, actual: f.enemyHpBefore === null ? null : Math.min(f.enemyHpBefore, e.amount), overflow: f.enemyHpBefore === null ? null : Math.max(0, e.amount - f.enemyHpBefore) } : null))).filter((e) => e !== null);
    const cardMap = new Map<string, {
        id: string;
        name: string;
        owned: number;
        seen: number;
        played: number;
    }>();
    let goldIncome = 0, goldSpent = 0;
    for (const record of normal) {
        const variant = manifest.variants.find((v) => v.id === record.variantId)!;
        for (const stage of stages) {
            if (!stage.keys.includes(record.key))
                continue;
            const owned = new Set<string>(), seen = new Set<string>(), played = new Set<string>();
            const ids = record.finalState?.cards ?? record.checkpoints[0]?.state.cards ?? {};
            Object.values(ids).forEach((c) => owned.add(c.instanceId));
            record.checkpoints.forEach((c) => { const frame = record.frames[c.afterFrames - 1]; if (c.state.battle && (frame?.battleIndex === stage.index || c.state.run.battlesWon + 1 === stage.index))
                c.state.zones.hand.forEach((id) => seen.add(id)); });
            record.frames.filter((f) => f.battleIndex === stage.index).forEach((f) => f.events.forEach((e) => { if (e.type === 'CardsDrawn')
                e.instanceIds.forEach((id) => seen.add(id)); if (e.type === 'CardsPlayed')
                e.instanceIds.forEach((id) => { played.add(id); seen.add(id); }); }));
            for (const id of owned) {
                const instance = ids[id];
                if (!instance)
                    continue;
                const definition = variant.config.cards.find((c) => c.id === instance.definitionId);
                if (!definition)
                    continue;
                const row = cardMap.get(definition.id) ?? { id: definition.id, name: definition.name, owned: 0, seen: 0, played: 0 };
                row.owned++;
                if (seen.has(id))
                    row.seen++;
                if (played.has(id))
                    row.played++;
                cardMap.set(row.id, row);
            }
        }
        record.frames.forEach((f) => { const delta = f.goldAfter - f.goldBefore; if (delta > 0)
            goldIncome += delta;
        else
            goldSpent -= delta; });
    }
    const independent = new Set(normal.map((r) => r.variantId)).size <= 1 && new Set(normal.map((r) => r.policy)).size <= 1;
    return { planned: manifest.plannedRuns, recordCount: records.length, normal: normal.length, won, lost: normal.length - won, coverage: normal.length / manifest.plannedRuns, statusCounts, winRate: normal.length ? won / normal.length : null, interval: independent ? wilson(won, normal.length) : null, stages, damages, damageMedian: quantile(damages.map((d) => d.damage), .5), damageP90: quantile(damages.map((d) => d.damage), .9), goldIncome, goldSpent, cards: [...cardMap.values()].sort((a, b) => a.name.localeCompare(b.name)), missingTrace: normal.filter((r) => r.quality === 'trace_incomplete').length, records };
}
export type LabReport = ReturnType<typeof aggregate>;
export function pairedComparison(manifest: ExperimentManifest, records: readonly RunRecord[], policy: RunRecord['policy']) {
    const effective=deduplicate(records);
    const [a, b] = manifest.variants;
    if (!a || !b)
        return { pairs: 0, missing: manifest.seeds.length, delta: null, interval: null, rows: [] };
    const rows = manifest.seeds.map((seed) => {
        const first = effective.find((r) => r.variantId === a.id && r.policy === policy && r.seed === seed);
        const second = effective.find((r) => r.variantId === b.id && r.policy === policy && r.seed === seed);
        const window=manifest.mode==='same-action';
        const damage=(r:RunRecord)=>r.frames.reduce((n,f)=>n+f.events.reduce((v,e)=>v+(e.type==='DamageResolved'?e.amount:0),0),0);
        const valid = first?.status === 'completed' && second?.status === 'completed' && (window||first.outcome !== undefined && second.outcome !== undefined);
        return { seed, a: first, b: second, valid, difference: valid ? window?damage(second)-damage(first):Number(second.outcome === 'won') - Number(first.outcome === 'won') : null };
    });
    const diffs = rows.filter((r) => r.valid).map((r) => r.difference!);
    return { pairs: diffs.length, missing: rows.length - diffs.length, delta: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null, interval: pairedBootstrap(diffs, manifest.bootstrapSeed), rows };
}
