import { createConfigRegistry } from '@config/config-registry';
import { freezeVariant, restoreConfig } from '../../lab/config-snapshot';
import { createManifest } from '../../lab/capabilities';
const loaded = createConfigRegistry();
if (!loaded.ok)
    throw new Error('基线配置无效');
const base = loaded.value.config;
describe('冻结实验配置', () => {
    it('完整快照可往返，草稿随后修改不影响冻结结果', async () => {
        const patch = { enemyStats: { 'three_kingdoms.enemy.hu_lao_mo_jiang': { maxHp: 3200 } } };
        const variant = await freezeVariant(base, patch, '首领调整');
        patch.enemyStats['three_kingdoms.enemy.hu_lao_mo_jiang'].maxHp = 1;
        const config = restoreConfig(JSON.parse(JSON.stringify(variant.config)));
        expect(config.enemies.get('three_kingdoms.enemy.hu_lao_mo_jiang')?.maxHp).toBe(3200);
        expect(base.enemies.get('three_kingdoms.enemy.hu_lao_mo_jiang')?.maxHp).toBe(3600);
        expect(Object.isFrozen(variant.config)).toBe(true);
    });
    it.each([
        { cardStats: { missing: { basePower: 20 } } },
        { enemyStats: { 'three_kingdoms.enemy.hu_lao_mo_jiang': { maxHp: -1 } } },
        { balance: { battle: { playSlotCount: 6 } } },
        { balance: { enhancement: { stageWeights: { first_reward: { common: 0, rare: 0, legendary: 0 } } } } },
    ])('拒绝非法或超出当前能力的参数 %j', async (patch) => {
        await expect(freezeVariant(base, patch, '非法')).rejects.toThrow();
    });
    it('种子去重，准确预告任务数并冻结清单', async () => {
        const a = await freezeVariant(base, {}, 'A');
        const b = await freezeVariant(base, { enemyStats: { 'three_kingdoms.enemy.hu_lao_mo_jiang': { maxHp: 3200 } } }, 'B');
        const manifest = await createManifest({ variants: [a, b], policies: ['legacy_match_v1', 'visible_damage_v1'], seeds: ['a', 'a', 'b'] });
        expect(manifest.seeds).toEqual(['a', 'b']);
        expect(manifest.plannedRuns).toBe(8);
        expect(Object.isFrozen(manifest)).toBe(true);
    });
    it('不支持的六战与超过预算的任务在启动前拒绝', async () => {
        const a = await freezeVariant(base, {}, 'A');
        await expect(createManifest({ variants: [a], policies: ['legacy_match_v1'], seeds: ['a'], ruleset: 'mobile_v2' })).rejects.toThrow('未接入');
        await expect(createManifest({ variants: [a], policies: ['legacy_match_v1', 'visible_damage_v1'], seeds: Array.from({ length: 10001 }, (_, i) => String(i)) })).rejects.toThrow('20,000');
    });
});
