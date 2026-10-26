import type { RngPort } from '../ports/rng-port';
import type { CardDefinition } from '../models/card-definition';
import type { DefinitionId } from '../models/ids';
import type { GameState } from '../state/game-state';
import type { BattleRules } from '../systems/battle-rules';
import { startBattle, type DomainOutcome, type StartBattleInput } from '../systems/battle-setup';

/**
 * 开始战斗命令。
 *
 * 领域系统不按战斗序号判断敌人，敌人与生命由流程节点从配置传入。
 */
export interface StartBattleCommandInput extends Omit<StartBattleInput, 'state'> {
  readonly state: GameState;
}

export function startBattleCommand(
  input: StartBattleCommandInput,
  rules: BattleRules,
  rng: RngPort,
  definitions: ReadonlyMap<DefinitionId, CardDefinition>,
): DomainOutcome {
  return startBattle({ ...input, rules, rng, definitions });
}
