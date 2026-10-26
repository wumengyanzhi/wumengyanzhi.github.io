import type { EffectiveConfig } from '@config/config-registry';
import type { GameState } from '@domain/state/game-state';
import type { InstanceId } from '@domain/models/ids';
import { clone } from './config-snapshot';
export function playerObservation(state: GameState, config: EffectiveConfig) {
    const visibleIds = [...state.zones.hand, ...state.zones.playSlots.filter((id): id is InstanceId => id !== null)];
    return clone({ run: state.run, battle: state.battle, pendingChoice: state.pendingChoice, slots: state.zones.playSlots, equipmentTargets: state.equipmentTargets, hand: visibleIds.map((id) => ({ instance: state.cards[id]!, definition: config.cards.get(state.cards[id]!.definitionId)! })), matchMatrix: config.matchMatrix, remainingDefinitions: Object.values(state.cards).map((c) => c.definitionId).sort() });
}
export type PlayerObservation = ReturnType<typeof playerObservation>;
