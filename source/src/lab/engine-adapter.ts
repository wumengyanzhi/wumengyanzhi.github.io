import { createGameController, type GameCommand, type GameController } from '@app/game-controller';
import { createRegistryFromConfig } from '@config/config-registry';
import type { GameState } from '@domain/state/game-state';
import type { InstanceId } from '@domain/models/ids';
import { playCards } from '@domain/commands/play-cards';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';
import { decodeSave } from '@infra/save-import-export/save-codec';
import { clone, restoreConfig } from './config-snapshot';
import type { FrozenVariant, TraceStep } from './model';
export class LabEngine {
    readonly config;
    readonly controller: GameController;
    private trace: TraceStep[] = [];
    incomplete = false;
    constructor(readonly variant: FrozenVariant, initial?: GameState, diagnostic = true) {
        this.config = restoreConfig(variant.config);
        const registry = createRegistryFromConfig(this.config);
        if (initial) {
            const checked = decodeSave(JSON.stringify(initial), registry);
            if (!checked.ok)
                throw new Error(checked.error.message);
            initial = checked.value.state;
        }
        this.controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng(), initialState: initial && clone(initial), trace: diagnostic ? { write: (s) => this.trace.push(clone(s)), onError: () => { this.incomplete = true; } } : undefined });
    }
    get state(): GameState | null { return this.controller.state; }
    dispatch(command: GameCommand) {
        if(command.type==='Play')this.preview(command.assignments);
        this.trace = [];
        const result = this.controller.dispatch(command);
        if (!result.ok)
            throw new Error(`${command.type}：${result.error.message}`);
        return { ...result.value, trace: clone(this.trace) };
    }
    preview(assignments: readonly {
        slotIndex: number;
        instanceId: InstanceId;
    }[], targets?: Readonly<Record<string, InstanceId>>) {
        if (!this.state)
            throw new Error('请先创建沙盘');
        const trace: TraceStep[] = [];
        const context = this.controller.selectors;
        const result = playCards({ state: this.state, assignments, targets, definitions: context.definitions, rules: context.rules, rng: context.rng, enhancementSkills: context.enhancementSkills, trace: { write: (s) => trace.push(s) } });
        if (!result.ok)
            throw new Error(result.error.message);
        const damage = result.value.events.find((e) => e.type === 'DamageResolved');
        if (!damage || damage.type !== 'DamageResolved')
            throw new Error('没有伤害记录');
        if(![damage.amount,damage.powerTotal,damage.ampTotal].every(Number.isSafeInteger))throw new Error('计算结果超过安全整数范围，请降低参数或场景数值');
        return { damage: damage.amount, powerTotal: damage.powerTotal, ampTotal: damage.ampTotal, trace };
    }
}
