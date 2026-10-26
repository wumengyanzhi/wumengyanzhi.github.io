import { createConfigRegistry } from '@config/config-registry';
import { freezeVariant } from '../../lab/config-snapshot';
import { LabEngine } from '../../lab/engine-adapter';
import { playerObservation } from '../../lab/observations';
import { createGameController } from '@app/game-controller';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';
const loaded = createConfigRegistry();
if (!loaded.ok)
    throw new Error('配置无效');
describe('隔离引擎与真实诊断', () => {
    it('超出安全整数范围的伤害拒绝执行，保留原状态',async()=>{
        const variant=await freezeVariant(loaded.value.config,{balance:{damage:{baseAmp:1000}}},'数值边界');const initial=new LabEngine(variant);initial.dispatch({type:'NewRun',seed:'unsafe'});const original=initial.state!;const id=original.zones.hand[0]!;
        const state={...original,cards:{...original.cards,[id]:{...original.cards[id]!,permanentPower:1_000_000_000_000_000}}};const engine=new LabEngine(variant,state);const assignments=[{slotIndex:0,instanceId:id}];
        expect(()=>engine.preview(assignments)).toThrow('安全整数');expect(()=>engine.dispatch({type:'Play',assignments})).toThrow('安全整数');expect(engine.state).toEqual(state);
    });
    it('配置快照保留初始牌库顺序，同种子与原控制器完全一致', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, '原规则');
        const original = createGameController({ registry: loaded.value, storage: createMemoryStorage(), rng: createSeededRng() });
        const engine = new LabEngine(variant);
        const command = { type: 'NewRun' as const, seed: 'legacy-order' };
        original.dispatch(command);
        engine.dispatch(command);
        expect(engine.state?.zones.hand).toEqual(original.state?.zones.hand);
        expect(engine.state).toEqual(original.state);
    });
    it('诊断开关不改变正式状态，预览不写状态或随机源', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, '基线');
        const a = new LabEngine(variant);
        const b = new LabEngine(variant, undefined, false);
        a.dispatch({ type: 'NewRun', seed: 'engine-test' });
        b.dispatch({ type: 'NewRun', seed: 'engine-test' });
        const id = a.state!.zones.hand[0]!;
        const assignments = [{ slotIndex: 0, instanceId: id }];
        const before = structuredClone(a.state);
        const preview = a.preview(assignments);
        a.preview(assignments);
        expect(a.state).toEqual(before);
        const actualA = a.dispatch({ type: 'Play', assignments });
        const actualB = b.dispatch({ type: 'Play', assignments });
        expect(actualA.state).toEqual(actualB.state);
        expect(actualA.events).toEqual(actualB.events);
        const damage = actualA.events.find((e) => e.type === 'DamageResolved');
        expect(damage?.type === 'DamageResolved' && damage.amount).toBe(preview.damage);
        expect(preview.trace.some((t) => t.kind === 'power')).toBe(true);
        expect(preview.trace.some((t) => t.kind === 'amp')).toBe(true);
    });
    it('公开观察不提供隐藏牌序或正式随机状态', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, '基线');
        const engine = new LabEngine(variant);
        engine.dispatch({ type: 'NewRun', seed: 'visible' });
        const state = engine.state!;
        const obs = playerObservation(state, engine.config);
        const changed = { ...state, rng: { ...state.rng, stream: 9 }, zones: { ...state.zones, drawPile: [...state.zones.drawPile].reverse() } };
        expect(playerObservation(changed, engine.config)).toEqual(obs);
        expect(obs).not.toHaveProperty('rng');
        expect(obs).not.toHaveProperty('drawPile');
    });
    it('非法场景不能恢复；每个引擎使用自己的存储', async () => {
        const variant = await freezeVariant(loaded.value.config, {}, '基线');
        const a = new LabEngine(variant);
        const b = new LabEngine(variant);
        a.dispatch({ type: 'NewRun', seed: 'a' });
        expect(b.state).toBeNull();
        const state = a.state!;
        expect(() => new LabEngine(variant, { ...state, zones: { ...state.zones, hand: [...state.zones.hand, state.zones.hand[0]!] } })).toThrow();
    });
});
