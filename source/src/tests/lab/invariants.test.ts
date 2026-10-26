import { createConfigRegistry } from '@config/config-registry';
import { createGameController } from '@app/game-controller';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';
import { asDefinitionId } from '@domain/models/ids';
import { createPreparedState, startBattleWith, setHand } from '../support/domain-fixture';
import { LabEngine } from '../../lab/engine-adapter';
import { freezeVariant, fingerprint } from '../../lab/config-snapshot';
import { playerObservation } from '../../lab/observations';
import { decide } from '../../lab/policies/visible-damage';
import { decodeExperiment, encodeExperiment } from '../../lab/export';
import { createManifest } from '../../lab/capabilities';
import { BatchRunner } from '../../lab/batch';
const registry = createConfigRegistry();
if (!registry.ok)
    throw new Error('配置无效');
const base = registry.value;
describe('实验室边界不变量', () => {
    it('必需预算键不能被其他四个数字字段替代',async()=>{
        const v=await freezeVariant(base.config,{},'预算');const m=await createManifest({variants:[v],policies:['legacy_match_v1'],seeds:['budget']});const b=new BatchRunner(m).snapshot;
        const invalid={...b,manifest:{...m,budgets:{one:1,two:1,three:1,four:1} as unknown as typeof m.budgets}};
        const accepted=await decodeExperiment(await encodeExperiment(invalid)).then(()=>true,()=>false);expect(accepted).toBe(false);
    });
    it('未到终局的固定动作窗口禁止伪造获胜',async()=>{
        const v=await freezeVariant(base.config,{},'窗口');const e=new LabEngine(v);e.dispatch({type:'NewRun',seed:'local-window'});
        const m=await createManifest({variants:[v],policies:['legacy_match_v1'],seeds:['local-window'],mode:'same-action',scenario:{id:'local',source:'seed',state:e.state!},fixedCommands:[{type:'Play',assignments:[{slotIndex:0,instanceId:e.state!.zones.hand[0]!}]}]});const b=new BatchRunner(m);await b.run(()=>{},async()=>{});
        const invalid={...b.snapshot,records:b.snapshot.records.map((r)=>({...r,outcome:'won' as const}))};
        const accepted=await decodeExperiment(await encodeExperiment(invalid)).then(()=>true,()=>false);expect(accepted).toBe(false);
    });
    it('空清单与没有合法终局的获胜样本都拒绝导入',async()=>{
        const v=await freezeVariant(base.config,{},'导入');const m=await createManifest({variants:[v],policies:['legacy_match_v1'],seeds:['import']});const s=new BatchRunner(m).snapshot;
        await expect(decodeExperiment(await encodeExperiment({...s,manifest:{...m,variants:[],policies:[],seeds:[],plannedRuns:0},records:[]}))).rejects.toThrow();
        const fake={...s,records:s.records.map((r)=>({...r,status:'completed' as const,outcome:'won' as const}))};
        await expect(decodeExperiment(await encodeExperiment(fake))).rejects.toThrow('终局');
    });
    it('重算包散列仍不能绕过检查点和命令结果校验',async()=>{
        const v=await freezeVariant(base.config,{},'回放校验');const m=await createManifest({variants:[v],policies:['legacy_match_v1'],seeds:['mvp-full-run']});const b=new BatchRunner(m);await b.run(()=>{},async()=>{});
        const s={...b.snapshot,records:b.snapshot.records.map((r,i)=>i?r:{...r,checkpoints:r.checkpoints.map((c,j)=>j?c:{...c,hash:'0'.repeat(64)})})};
        await expect(decodeExperiment(await encodeExperiment(s))).rejects.toThrow('检查点');
    });
    it('省略空字段不改变持久化指纹', async () => { expect(await fingerprint({ optional: undefined, value: 2 })).toBe(await fingerprint({ value: 2 })); });
    it('诊断接收器抛错不会改变正式状态和事件', () => {
        const plain = createGameController({ registry: base, storage: createMemoryStorage(), rng: createSeededRng() });
        let errors = 0;
        const traced = createGameController({ registry: base, storage: createMemoryStorage(), rng: createSeededRng(), trace: { write: () => { throw Error('sink'); }, onError: () => { errors++; } } });
        plain.dispatch({ type: 'NewRun', seed: 'trace-error' });
        traced.dispatch({ type: 'NewRun', seed: 'trace-error' });
        const assignments = [{ slotIndex: 0, instanceId: plain.state!.zones.hand[0]! }];
        expect(traced.dispatch({ type: 'Play', assignments })).toEqual(plain.dispatch({ type: 'Play', assignments }));
        expect(errors).toBeGreaterThan(0);
    });
    it('全武器手牌保留合法单牌候选', async () => {
        const variant = await freezeVariant(base.config, {}, '单牌');
        const ids = [asDefinitionId('three_kingdoms.weapon.huan_shou_dao')];
        const state = setHand(startBattleWith(createPreparedState({ deckDefinitionIds: ids })), ids);
        const engine = new LabEngine(variant, state);
        const d = decide(playerObservation(state, engine.config), (p, t) => engine.preview(p, t));
        expect(d.commands.some((c) => c.type === 'Play')).toBe(true);
        expect(d.evaluated).toBeGreaterThan(0);
    });
    it('金币来源写入真实诊断，不从总值猜测', async () => {
        const variant = await freezeVariant(base.config, {}, '金币');
        const ids = [asDefinitionId('three_kingdoms.character.shu_zhong_meng_shi'), asDefinitionId('three_kingdoms.weapon.huan_shou_dao'), asDefinitionId('three_kingdoms.tactic.chou_cuo_jun_liang')];
        const state = setHand(startBattleWith(createPreparedState({ deckDefinitionIds: ids })), ids);
        const engine = new LabEngine(variant, state);
        const output = engine.dispatch({ type: 'Play', assignments: state.zones.hand.map((id, slotIndex) => ({ slotIndex, instanceId: id })) });
        expect(output.events.some((e) => e.type === 'GoldGained')).toBe(true);
        expect(output.trace.some((t) => t.kind === 'resource' && t.after! > t.before!)).toBe(true);
    });
    it('可读包缺少引擎时只读；不能伪造非法状态账', async () => {
        const variant = await freezeVariant(base.config, {}, '包');
        const manifest = await createManifest({ variants: [variant], policies: ['legacy_match_v1'], seeds: ['pack'] });
        const snapshot = new BatchRunner(manifest).snapshot;
        const future = { ...snapshot, manifest: { ...manifest, engineVersion: 'future-engine' } };
        expect((await decodeExperiment(await encodeExperiment(future))).readOnly).toBe(true);
        const invalid = { ...snapshot, records: snapshot.records.map((r) => ({ ...r, status: 'unknown' })) };
        await expect(decodeExperiment(await encodeExperiment(invalid as unknown as typeof snapshot))).rejects.toThrow('状态');
    });
});
