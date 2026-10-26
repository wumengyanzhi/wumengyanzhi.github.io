import type { GameCommand } from '@app/game-controller';
import type { InstanceId } from '@domain/models/ids';
import type { CardType } from '@domain/models/enums';
import type { PlayerObservation } from '../observations';
import type { DecisionRecord } from '../model';
export type Plan = readonly {
    slotIndex: number;
    instanceId: InstanceId;
}[];
export type PublicPreview = (plan: Plan, targets: Readonly<Record<string, InstanceId>>) => {
    damage: number;
    powerTotal: number;
    ampTotal: number;
};
function targetOptions(obs: PlayerObservation, plan: Plan): Readonly<Record<string, InstanceId>>[] {
    let options: Record<string, InstanceId>[] = [{}];
    for (const p of plan) {
        const card = obs.hand.find((c) => c.instance.instanceId === p.instanceId);
        if (card?.definition.cardType !== 'weapon')
            continue;
        const neighbours = plan.filter((n) => Math.abs(n.slotIndex - p.slotIndex) === 1 && obs.hand.find((c) => c.instance.instanceId === n.instanceId)?.definition.cardType === 'character');
        if (neighbours.length === 2)
            options = options.flatMap((o) => neighbours.map((n) => ({ ...o, [p.instanceId]: n.instanceId })));
    }
    return options;
}
export function commandsFor(obs: PlayerObservation, plan: Plan, targets?: Readonly<Record<string, InstanceId>>): GameCommand[] {
    const chosen = targets ?? targetOptions(obs, plan)[0] ?? {};
    return [...obs.slots.flatMap((id, slotIndex) => id === null ? [] : [{ type: 'UnstageCard' as const, slotIndex }]), ...plan.map((p) => ({ type: 'StageCard' as const, ...p })), ...Object.entries(chosen).map(([weaponInstanceId, targetInstanceId]) => ({ type: 'SelectWeaponTarget' as const, weaponInstanceId: weaponInstanceId as InstanceId, targetInstanceId })), { type: 'Play', assignments: plan }];
}
function* arrangements(obs: PlayerObservation, pattern: readonly CardType[]): Generator<Plan> {
    const sorted = [...obs.hand].sort((a, b) => (b.definition.basePower + b.instance.permanentPower + 20 * (('baseAmp' in b.definition ? b.definition.baseAmp : 0) + b.instance.permanentAmp)) - (a.definition.basePower + a.instance.permanentPower + 20 * (('baseAmp' in a.definition ? a.definition.baseAmp : 0) + a.instance.permanentAmp)) || a.instance.instanceId.localeCompare(b.instance.instanceId));
    function* fill(index: number, plan: Plan): Generator<Plan> {
        if (index === pattern.length) {
            yield plan;
            return;
        }
        for (const c of sorted)
            if (c.definition.cardType === pattern[index] && !plan.some((p) => p.instanceId === c.instance.instanceId))
                yield* fill(index + 1, [...plan, { slotIndex: index, instanceId: c.instance.instanceId }]);
    }
    yield* fill(0, []);
}
export function decide(obs: PlayerObservation, preview: PublicPreview): DecisionRecord {
    if (obs.pendingChoice?.kind === 'enhancement_reward') {
        const candidates = [...obs.pendingChoice.candidates].sort((a, b) => (b.attribute === 'power' ? b.amount / 20 : b.amount) - (a.attribute === 'power' ? a.amount / 20 : a.amount));
        const first = candidates[0];
        if (!first)
            throw new Error('强化候选为空');
        return { policy: 'visible_damage_v1', evaluated: 0, truncated: false, reason: '比较公开强化增量，附加技能不估价', commands: [{ type: 'ChooseEnhancement', candidateId: first.id }] };
    }
    let evaluated = 0, truncated = false;
    let best: {
        plan: Plan;
        targets: Readonly<Record<string, InstanceId>>;
        damage: number;
        key: string;
    } | null = null;
    const seen = new Set<string>();
    const evaluate = (plan: Plan) => {
        for (const targets of targetOptions(obs, plan)) {
            const key = JSON.stringify([plan, targets]);
            if (seen.has(key))
                continue;
            seen.add(key);
            if (evaluated >= 256) {
                truncated = true;
                return;
            }
            evaluated++;
            let result;
            try {
                result = preview(plan, targets);
            }
            catch {
                continue;
            }
            const damage = result.damage;
            const lethal = damage >= (obs.battle?.enemyCurrentHp ?? Infinity);
            const previousLethal = best && best.damage >= (obs.battle?.enemyCurrentHp ?? Infinity);
            if (!best || (lethal && !previousLethal) || (lethal === Boolean(previousLethal) && (damage > best.damage || (damage === best.damage && (plan.length < best.plan.length || (plan.length === best.plan.length && key < best.key))))))
                best = { plan, targets, damage, key };
        }
    };
    obs.hand.forEach((c) => evaluate([{ slotIndex: 0, instanceId: c.instance.instanceId }]));
    const patterns: CardType[][] = [['weapon', 'character', 'character', 'weapon', 'tactic'], ['weapon', 'character', 'character', 'weapon'], ['weapon', 'character', 'weapon', 'tactic'], ['character', 'tactic', 'character'], ['tactic', 'tactic', 'character'], ['character', 'weapon'], ['character', 'tactic', 'tactic', 'tactic', 'character']];
    const streams = patterns.map((p) => arrangements(obs, p));
    while (streams.length && evaluated < 256) {
        for (let i = streams.length - 1; i >= 0; i--) {
            const n = streams[i]!.next();
            if (n.done)
                streams.splice(i, 1);
            else
                evaluate(n.value);
        }
    }
    if (streams.length)
        truncated = true;
    const chosen = best as {
        plan: Plan;
        targets: Readonly<Record<string, InstanceId>>;
        damage: number;
        key: string;
    } | null;
    if (!chosen)
        throw new Error('候选生成器未提供合法动作');
    return { policy: 'visible_damage_v1', evaluated, truncated, reason: `受限即时伤害搜索：评估 ${evaluated} 个候选，伤害 ${chosen.damage}；不主动弃牌`, commands: commandsFor(obs, chosen.plan, chosen.targets) };
}
