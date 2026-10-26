import { createConfigRegistry } from '@config/config-registry';
import { freezeVariant } from '../../lab/config-snapshot';
import { createManifest } from '../../lab/capabilities';
import { BatchRunner } from '../../lab/batch';
import { LabRepository, MemoryBackend } from '../../lab/repository';
import { aggregate, pairedComparison } from '../../lab/metrics';
import { wilson } from '../../lab/statistics';
import { encodeExperiment, decodeExperiment } from '../../lab/export';
const base = createConfigRegistry();
if (!base.ok)
    throw new Error('配置无效');
const config = base.value.config;
async function prepared() {
    const a = await freezeVariant(config, {}, 'A');
    const b = await freezeVariant(config, { enemyStats: { 'three_kingdoms.enemy.hu_lao_mo_jiang': { maxHp: 3200 } } }, 'B');
    return createManifest({ variants: [a, b], policies: ['legacy_match_v1'], seeds: ['batch-1', 'batch-2'] });
}
describe('批量运行、持久化与报告', () => {
    it('暂停重载后的停止立即形成终态，并取消所有未完成项',async()=>{
        const manifest=await prepared();const batch=new BatchRunner(manifest);
        let once=false;await batch.run(()=>{if(!once){once=true;batch.pause();}},async()=>{});
        const restored=new BatchRunner(manifest,batch.snapshot);restored.stop();
        expect(restored.snapshot.status).toBe('stopped');expect(restored.snapshot.records.every((r)=>r.status==='cancelled')).toBe(true);
        await expect(restored.run(()=>{},async()=>{})).rejects.toThrow();
    });
    it('暂停续跑不双计；状态账与逐战恒等式成立', async () => {
        const manifest = await prepared();
        const batch = new BatchRunner(manifest);
        let paused = false;
        await batch.run((snapshot) => { if (!paused && snapshot.records.some((r) => r.frames.length >= 4)) {
            paused = true;
            batch.pause();
        } }, async () => { });
        expect(batch.snapshot.status).toBe('paused');
        const restored = new BatchRunner(manifest, batch.snapshot);
        await restored.run(() => { }, async () => { });
        const report = aggregate(manifest, restored.snapshot.records);
        expect(report.planned).toBe(4);
        expect(report.normal).toBe(4);
        expect(report.statusCounts.completed).toBe(4);
        expect(report.stages[0]?.reached).toBe(4);
        expect(report.stages.every((s) => s.reached === s.won + s.lost)).toBe(true);
        expect(pairedComparison(manifest, restored.snapshot.records, 'legacy_match_v1').pairs).toBe(2);
    });
    it('停止为终态，取消不增加正常败局', async () => {
        const manifest = await prepared();
        const batch = new BatchRunner(manifest);
        await batch.run(() => batch.stop(), async () => { });
        const report = aggregate(manifest, batch.snapshot.records);
        expect(batch.snapshot.status).toBe('stopped');
        expect(report.normal).toBe(0);
        expect(report.statusCounts.cancelled).toBe(4);
        await expect(batch.run(() => { }, async () => { })).rejects.toThrow();
    });
    it('实验存储原子保存，额度不足不覆盖旧结果；导出往返并检出破损', async () => {
        const manifest = await prepared();
        const batch = new BatchRunner(manifest);
        await batch.run(() => { }, async () => { });
        const repo = new LabRepository(new MemoryBackend());
        await repo.saveBatch(batch.snapshot);
        const recovered = await repo.loadBatch(manifest.id);
        expect(recovered).toEqual(batch.snapshot);
        const raw = await encodeExperiment(batch.snapshot);
        expect((await decodeExperiment(raw)).snapshot).toEqual(batch.snapshot);
        const changed = JSON.parse(raw);
        changed.payload.records[0].seed = 'changed';
        await expect(decodeExperiment(JSON.stringify(changed))).rejects.toThrow('散列');
        const tiny = { ...batch.snapshot, manifest: { ...manifest, budgets: { ...manifest.budgets, storageBytes: 1 } } };
        await expect(repo.saveBatch(tiny)).rejects.toThrow('额度');
        expect(await repo.loadBatch(manifest.id)).toEqual(recovered);
    });
    it('Wilson 区间有限且零分母无区间', () => {
        expect(wilson(0, 0)).toBeNull();
        expect(wilson(0, 100)?.[1]).toBeGreaterThan(0);
        expect(wilson(100, 100)?.[0]).toBeLessThan(1);
        expect(wilson(50, 100)?.[0]).toBeCloseTo(.404, 2);
    });
});
