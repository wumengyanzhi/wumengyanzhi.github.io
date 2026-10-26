import { useEffect, useState } from 'react';
import type { GameState } from '@domain/state/game-state';
import type { InstanceId } from '@domain/models/ids';
import { withZone } from '@domain/models/card-instance';
import type { FrozenVariant, Scenario } from '../model';
import { clone } from '../config-snapshot';
import { errorText } from './shared';
export function FixtureEditor({ state, variant, disabled, onApply, onError }: {
    state: GameState | null;
    variant: FrozenVariant;
    disabled: boolean;
    onApply: (state: GameState, source: Scenario['source']) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [values, setValues] = useState({ hp: 0, plays: 4, discards: 3, morale: 0, gold: 2, tier: 'formed' }), [hand, setHand] = useState<InstanceId[]>([]), [focus, setFocus] = useState(''), [stats, setStats] = useState({ permanentPower: 0, permanentAmp: 0, battleTemporaryPower: 0, battleTemporaryAmp: 0, thisPlayPower: 0, thisPlayAmp: 0 });
    useEffect(() => { if (state) {
        setValues({ hp: state.battle?.enemyCurrentHp ?? 0, plays: state.battle?.playCountRemaining ?? 0, discards: state.battle?.discardCountRemaining ?? 0, morale: state.battle?.moraleTotal ?? 0, gold: state.run.gold, tier: state.battle?.moraleTier ?? 'none' });
        setHand([...state.zones.hand]);
    } }, [state]);
    useEffect(() => { const card = state?.cards[focus]; if (card)
        setStats({ permanentPower: card.permanentPower, permanentAmp: card.permanentAmp, battleTemporaryPower: card.battleTemporaryPower, battleTemporaryAmp: card.battleTemporaryAmp, thisPlayPower: card.thisPlayPower, thisPlayAmp: card.thisPlayAmp }); }, [state, focus]);
    const alive = state ? Object.values(state.cards).filter((c) => c.zone !== 'consumed' && c.zone !== 'removed') : [];
    async function apply() { try {
        if (!state?.battle)
            return;
        const next = clone(state);
        const cards = Object.fromEntries(Object.entries(next.cards).map(([id, card]) => [id, alive.some((c) => c.instanceId === id) ? { ...withZone(card, hand.includes(card.instanceId) ? 'hand' : 'drawPile'), equippedToInstanceId: null, ...(id === focus ? stats : {}) } : card]));
        await onApply({ ...next, cards, run: { ...next.run, gold: values.gold }, battle: { ...next.battle!, enemyCurrentHp: values.hp, playCountRemaining: values.plays, discardCountRemaining: values.discards, moraleTotal: values.morale, moraleTier: values.tier as NonNullable<GameState['battle']>['moraleTier'] }, equipmentTargets: {}, zones: { ...next.zones, hand, drawPile: alive.map((c) => c.instanceId).filter((id) => !hand.includes(id)), discardPile: [], playSlots: next.zones.playSlots.map(() => null) } }, 'fixture');
    }
    catch (e) {
        onError(errorText(e));
    } }
    async function importSave(file: File) { try {
        if (file.size > 2000000)
            throw new Error('原型存档超过 2MB');
        await onApply(JSON.parse(await file.text()) as GameState, 'save');
    }
    catch (e) {
        onError(errorText(e));
    } }
    return <details className="lab-card"><summary>人工边界场景 / 导入原型存档</summary><p className="lab-muted">修改会生成独立场景并清空原操作时间线；人工夹具只用于局部检查，不进入自然对局通关率。</p><label className="lab-file-button">导入原型存档<input type="file" accept=".json" disabled={disabled} onChange={(e) => { const f = e.target.files?.[0]; if (f)
        void importSave(f); e.target.value = ''; }}/></label>{state?.battle && <><div className="lab-grid-two lab-fixture-fields">{([['hp', '敌人当前生命'], ['plays', '剩余出战次数'], ['discards', '剩余弃牌次数'], ['morale', '军势总点数'], ['gold', '场景金币']] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={label} disabled={disabled} type="number" min={0} value={values[key]} onChange={(e) => setValues({ ...values, [key]: Number(e.target.value) })}/></label>)}<label>军势档位<select disabled={disabled} value={values.tier} onChange={(e) => setValues({ ...values, tier: e.target.value })}><option value="none">未成军</option><option value="formed">成军</option><option value="array">列阵</option></select></label></div><fieldset><legend>手牌实体（至多 8 张，应用后格位清空）</legend>{alive.map((c) => <label className="lab-check" key={c.instanceId}><input type="checkbox" disabled={disabled || (!hand.includes(c.instanceId) && hand.length >= 8)} checked={hand.includes(c.instanceId)} onChange={(e) => setHand(e.target.checked ? [...hand, c.instanceId] : hand.filter((id) => id !== c.instanceId))}/>{variant.config.cards.find((d) => d.id === c.definitionId)?.name}</label>)}</fieldset><fieldset><legend>卡牌数值层</legend><label>选择实体<select value={focus} onChange={(e) => setFocus(e.target.value)}><option value="">请选择要修改的卡牌</option>{alive.map((c) => <option key={c.instanceId} value={c.instanceId}>{variant.config.cards.find((d) => d.id === c.definitionId)?.name}</option>)}</select></label>{focus && <div className="lab-grid-two lab-fixture-fields">{([['permanentPower', '本局永久威力'], ['permanentAmp', '本局永久增幅'], ['battleTemporaryPower', '本场临时威力'], ['battleTemporaryAmp', '本场临时增幅'], ['thisPlayPower', '本手威力'], ['thisPlayAmp', '本手增幅']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min={0} disabled={disabled} value={stats[key]} onChange={(e) => setStats({ ...stats, [key]: Number(e.target.value) })}/></label>)}</div>}<p className="lab-muted">基础数值在参数方案中修改；本页只修改隔离实体。</p></fieldset><button className="primary" disabled={disabled} onClick={() => void apply()}>应用人工场景</button></>}</details>;
}
