import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { EnhancementBalance } from '@config/schemas/balance.schema';
import type { CardDefinition } from '../models/card-definition';
import type { DefinitionId } from '../models/ids';
import type { EnhancementTier } from '../models/enums';
import type { RngPort, RngState } from '../ports/rng-port';
import type { EnhancementCandidate, GameState } from '../state/game-state';

export interface GenerateEnhancementInput {
  readonly state: GameState;
  readonly stageId: string;
  readonly config: EnhancementBalance;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly rng: RngPort;
}

function rollIndex(rng: RngPort, state: RngState, length: number): { index: number; rng: RngState } {
  const roll = rng.nextInt(state, length);
  return { index: roll.value, rng: roll.state };
}

function chooseTier(
  rng: RngPort,
  state: RngState,
  weights: Readonly<Record<EnhancementTier, number>>,
): { tier: EnhancementTier; rng: RngState } {
  const total = weights.common + weights.rare + weights.legendary;
  const roll = rollIndex(rng, state, total);
  const tier = roll.index < weights.common
    ? 'common'
    : roll.index < weights.common + weights.rare ? 'rare' : 'legendary';
  return { tier, rng: roll.rng };
}

function attributesFor(definition: CardDefinition, config: EnhancementBalance): readonly ('power' | 'amp')[] {
  if (definition.cardType === 'character') return config.allowedAttributes.character;
  if (definition.cardType === 'weapon') return config.allowedAttributes.weapon;
  return config.allowedAttributes[definition.tacticDirection === 'power' ? 'tactic_power' : 'tactic_amp'];
}

export function generateEnhancementCandidates(
  input: GenerateEnhancementInput,
): Result<{ state: GameState }, AppError> {
  const weights = input.config.stageWeights[input.stageId];
  if (weights === undefined) {
    return err(createAppError(AppErrorCode.InvalidCommand, '奖励概率表不存在'));
  }
  const removed = new Set(input.state.zones.removed);
  const available = Object.values(input.state.cards)
    .filter((card) => !removed.has(card.instanceId) && input.definitions.has(card.definitionId))
    .map((card) => card.instanceId);
  if (available.length < input.config.candidateCount) {
    return err(createAppError(AppErrorCode.CommandRejected, '可强化卡牌不足'));
  }

  let rngState = input.state.rng;
  const candidates: EnhancementCandidate[] = [];
  for (let index = 0; index < input.config.candidateCount; index += 1) {
    const targetRoll = rollIndex(input.rng, rngState, available.length);
    rngState = targetRoll.rng;
    const [targetInstanceId] = available.splice(targetRoll.index, 1);
    const instance = targetInstanceId === undefined ? undefined : input.state.cards[targetInstanceId];
    const definition = instance === undefined ? undefined : input.definitions.get(instance.definitionId);
    if (targetInstanceId === undefined || instance === undefined || definition === undefined) {
      return err(createAppError(AppErrorCode.ConfigInvalid, '强化目标定义不存在'));
    }
    const tierRoll = chooseTier(input.rng, rngState, weights);
    rngState = tierRoll.rng;
    const attributes = attributesFor(definition, input.config);
    if (attributes.length === 0) {
      return err(createAppError(AppErrorCode.ConfigInvalid, '强化目标没有合法属性'));
    }
    const attributeRoll = rollIndex(input.rng, rngState, attributes.length);
    rngState = attributeRoll.rng;
    const attribute = attributes[attributeRoll.index];
    if (attribute === undefined) {
      return err(createAppError(AppErrorCode.ConfigInvalid, '强化属性不存在'));
    }

    let skillId: string | null = null;
    if (tierRoll.tier === 'legendary') {
      const skills = input.config.legendarySkillPool.filter(
        (skill) =>
          !instance.enhancementSkillIds.includes(skill.id) &&
          (skill.effect.kind !== 'repeat_original' || definition.effects.length > 0),
      );
      if (skills.length > 0) {
        const skillRoll = rollIndex(input.rng, rngState, skills.length);
        rngState = skillRoll.rng;
        skillId = skills[skillRoll.index]?.id ?? null;
      } else {
        return err(createAppError(AppErrorCode.CommandRejected, '该卡已无可获得的传说技能'));
      }
    }
    candidates.push({
      id: `${input.stageId}-${index + 1}`,
      targetInstanceId,
      tier: tierRoll.tier,
      attribute,
      amount: input.config.tierValues[tierRoll.tier][attribute],
      skillId,
    });
  }

  return ok({
    state: {
      ...input.state,
      rng: rngState,
      pendingChoice: { kind: 'enhancement_reward', stageId: input.stageId, candidates },
    },
  });
}
