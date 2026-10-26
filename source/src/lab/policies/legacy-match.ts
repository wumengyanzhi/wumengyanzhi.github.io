import type { InstanceId } from '@domain/models/ids';
import type { PlayerObservation } from '../observations';
import type { DecisionRecord } from '../model';
import { commandsFor } from './visible-damage';
export function legacyDecide(obs: PlayerObservation): DecisionRecord {
    if (obs.pendingChoice?.kind === 'enhancement_reward') {
        const first = obs.pendingChoice.candidates[0];
        if (!first)
            throw new Error('强化候选为空');
        return { policy: 'legacy_match_v1', evaluated: 0, truncated: false, reason: '旧基线：选择第一个强化候选，不主动弃牌', commands: [{ type: 'ChooseEnhancement', candidateId: first.id }] };
    }
    const chars = obs.hand.filter((c) => c.definition.cardType === 'character');
    const weapons = obs.hand.filter((c) => c.definition.cardType === 'weapon');
    const tactics = obs.hand.filter((c) => c.definition.cardType === 'tactic');
    type Plan = readonly {
        slotIndex: number;
        instanceId: InstanceId;
    }[];
    let best: {
        score: number;
        power: number;
        plan: Plan;
    } | null = null;
    for (const [leftSlot, rightSlot] of [[0, 3], [0, 2], [1, 3]]) {
        for (const lw of weapons)
            for (const rw of weapons)
                for (const lc of chars)
                    for (const rc of chars) {
                        if (lw === rw || lc === rc || lw.definition.cardType !== 'weapon' || rw.definition.cardType !== 'weapon' || lc.definition.cardType !== 'character' || rc.definition.cardType !== 'character')
                            continue;
                        const relation = (w: typeof lw, c: typeof lc) => w.definition.cardType === 'weapon' && c.definition.cardType === 'character' ? obs.matchMatrix.relationAmp[obs.matchMatrix.matrix[c.definition.profession][w.definition.weaponClass]] : 0;
                        const score = relation(lw, lc) + relation(rw, rc);
                        if (!score)
                            continue;
                        const power = lw.definition.basePower + rw.definition.basePower + lc.definition.basePower + rc.definition.basePower;
                        if (!best || score > best.score || (score === best.score && power > best.power))
                            best = { score, power, plan: [{ slotIndex: leftSlot!, instanceId: lw.instance.instanceId }, { slotIndex: leftSlot! + 1, instanceId: lc.instance.instanceId }, { slotIndex: rightSlot!, instanceId: rw.instance.instanceId }, { slotIndex: rightSlot! + 1, instanceId: rc.instance.instanceId }] };
                    }
    }
    let plan: Plan = best?.plan ?? [...chars, ...weapons, ...tactics].slice(0, 5).map((c, slotIndex) => ({ slotIndex, instanceId: c.instance.instanceId }));
    if (best) {
        const free = [0, 1, 2, 3, 4].find((i) => !plan.some((p) => p.slotIndex === i));
        const tactic = tactics[0];
        if (free !== undefined && tactic)
            plan = [...plan, { slotIndex: free, instanceId: tactic.instance.instanceId }];
    }
    if (!plan.length)
        throw new Error('策略没有可出的牌');
    return { policy: 'legacy_match_v1', evaluated: 0, truncated: false, reason: '旧基线：匹配增幅优先，同分看基础威力', commands: commandsFor(obs, plan) };
}
