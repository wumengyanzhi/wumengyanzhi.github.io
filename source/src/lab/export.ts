import { fingerprint } from './config-snapshot';
import { type BatchSnapshot } from './model';
import { aggregate } from './metrics';
import { validatePackageSnapshot } from './package-validation';
export async function encodeExperiment(snapshot: BatchSnapshot): Promise<string> { return JSON.stringify({ format: 'three-kingdoms-lab', version: 1, checksum: await fingerprint(snapshot), payload: snapshot }); }
export async function decodeExperiment(raw: string): Promise<{
    snapshot: BatchSnapshot;
    readOnly: boolean;
}> {
    if (!raw || new TextEncoder().encode(raw).length > 200 * 1024 * 1024)
        throw new Error('实验包为空或超过 200MiB');
    const pack = JSON.parse(raw) as {
        format: string;
        version: number;
        checksum: string;
        payload: BatchSnapshot;
    };
    if (pack.format !== 'three-kingdoms-lab' || pack.version !== 1)
        throw new Error('实验包版本不可解释');
    if (await fingerprint(pack.payload) !== pack.checksum)
        throw new Error('实验包散列不一致');
    const s=pack.payload;
    const readOnly=await validatePackageSnapshot(s);
    return {snapshot:s.status==='running'?{...s,status:'paused',records:s.records.map((r)=>r.status==='running'?{...r,status:'paused'}:r)}:s,readOnly};
}
export function reportMarkdown(snapshot: BatchSnapshot): string {
    const r = aggregate(snapshot.manifest, snapshot.records);
    return `# ${snapshot.manifest.name}\n\n规则：${snapshot.manifest.ruleset} / ${snapshot.manifest.engineVersion}。种子集：${snapshot.manifest.split}。\n\n计划 ${r.planned} 局；正常完成 ${r.normal} 局，胜 ${r.won}、负 ${r.lost}。\n\n通关率：${r.winRate === null ? '无适用样本' : (r.winRate * 100).toFixed(1) + '%'}。异常状态：${JSON.stringify(r.statusCounts)}。\n\n|战次|到达|胜|负|条件胜率|累计通过率|\n|---|---:|---:|---:|---:|---:|\n${r.stages.map((s) => `|${s.index}|${s.reached}|${s.won}|${s.lost}|${s.conditional === null ? '—' : (100 * s.conditional).toFixed(1) + '%'}|${s.cumulative === null ? '—' : (100 * s.cumulative).toFixed(1) + '%'}|`).join('\n')}\n\n自动策略结果仅描述这批种子，不代表真人乐趣或游玩时长。\n`;
}
export function reportCsv(snapshot: BatchSnapshot): string {
    const quote = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    return '\ufeffvariant,policy,seed,status,outcome,commands,reason\n' + snapshot.records.map((r) => [r.variantId, r.policy, r.seed, r.status, r.outcome, r.frames.length, r.reason].map(quote).join(',')).join('\n');
}
