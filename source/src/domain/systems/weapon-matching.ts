import { AppErrorCode, createAppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { CardDefinition, CharacterDefinition, WeaponDefinition } from '../models/card-definition';
import type { DefinitionId, InstanceId } from '../models/ids';
import type { MatchRelation, MoraleTier } from '../models/enums';
import type { CardInstanceMap } from '../state/game-state';
import type { PlaySlot } from '../models/zone';
import type { BattleRules } from './battle-rules';

/**
 * 相邻装备与职业匹配。
 *
 * 武器只检查紧邻的左右位置；两侧都是人物时必须由玩家指定目标；
 * 每张武器在一次结算中只产生一次匹配结果。
 */

export interface EquipBinding {
  readonly weaponInstanceId: InstanceId;
  readonly targetInstanceId: InstanceId;
  readonly relation: MatchRelation;
  readonly ampBonus: number;
}

export interface ResolveEquipmentInput {
  readonly slots: readonly PlaySlot[];
  readonly cards: CardInstanceMap;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly rules: BattleRules;
  /** 玩家指定的装备目标：武器实例 ID → 人物实例 ID。 */
  readonly targets: Readonly<Record<string, InstanceId>>;
}

export interface ResolveEquipmentResult {
  readonly bindings: readonly EquipBinding[];
  readonly weaponsNeedingTarget: readonly InstanceId[];
}

function isCharacter(definition: CardDefinition | undefined): definition is CharacterDefinition {
  return definition?.cardType === 'character';
}

function isWeapon(definition: CardDefinition | undefined): definition is WeaponDefinition {
  return definition?.cardType === 'weapon';
}

export function resolveEquipments(input: ResolveEquipmentInput): Result<ResolveEquipmentResult, ReturnType<typeof createAppError>> {
  const bindings: EquipBinding[] = [];
  const weaponsNeedingTarget: InstanceId[] = [];

  for (let index = 0; index < input.slots.length; index += 1) {
    const weaponInstanceId = input.slots[index];
    if (weaponInstanceId === null || weaponInstanceId === undefined) {
      continue;
    }
    const weapon = input.cards[weaponInstanceId];
    const weaponDefinition = weapon === undefined ? undefined : input.definitions.get(weapon.definitionId);
    if (weapon === undefined || !isWeapon(weaponDefinition)) {
      continue;
    }

    const leftId = index > 0 ? input.slots[index - 1] : null;
    const rightId = index < input.slots.length - 1 ? input.slots[index + 1] : null;
    const neighbours: InstanceId[] = [];
    for (const candidate of [leftId ?? undefined, rightId ?? undefined]) {
      if (candidate === undefined) continue;
      const card = input.cards[candidate];
      const definition = card === undefined ? undefined : input.definitions.get(card.definitionId);
      if (isCharacter(definition)) {
        neighbours.push(candidate);
      }
    }

    let targetInstanceId: InstanceId | undefined;
    if (neighbours.length === 1) {
      targetInstanceId = neighbours[0];
    } else if (neighbours.length > 1) {
      const explicitTarget = input.targets[weaponInstanceId];
      if (explicitTarget === undefined) {
        weaponsNeedingTarget.push(weaponInstanceId);
        continue;
      }
      if (!neighbours.includes(explicitTarget)) {
        return err(
          createAppError(AppErrorCode.InvalidCommand, '装备目标不是该武器的相邻人物', {
            weaponInstanceId,
          }),
        );
      }
      targetInstanceId = explicitTarget;
    }

    if (targetInstanceId === undefined) {
      continue;
    }
    const target = input.cards[targetInstanceId];
    const targetDefinition = target === undefined ? undefined : input.definitions.get(target.definitionId);
    if (target === undefined || !isCharacter(targetDefinition)) {
      continue;
    }

    const relation = input.rules.matrix[targetDefinition.profession]?.[weaponDefinition.weaponClass] ?? 'none';
    bindings.push({
      weaponInstanceId,
      targetInstanceId,
      relation,
      ampBonus: input.rules.relationAmp[relation] ?? 0,
    });
  }

  return ok({ bindings, weaponsNeedingTarget });
}

/**
 * 出牌框变动后，只保留仍然成立的配属。
 *
 * 规则：武器和它指定的那个人物都还在框里、并且仍然紧邻，这条配属就继续有效——
 * 指定一次就够，之后往框里加别的牌、或拿走不相干的牌，都不必再指定一遍。
 *
 * 反过来，两条里缺任何一条都必须作废：留一条「武器还在、目标已经不在身边」的配属，
 * 出战时会被判成非法目标把玩家卡死（resolveEquipments 明确拒绝非相邻目标）。
 */
export function pruneEquipmentTargets(
  slots: readonly PlaySlot[],
  targets: Readonly<Record<string, InstanceId>>,
): Readonly<Record<string, InstanceId>> {
  const kept: Record<string, InstanceId> = {};
  for (const [weaponId, targetId] of Object.entries(targets)) {
    const weaponIndex = slots.indexOf(weaponId as InstanceId);
    if (weaponIndex < 0) continue;
    const targetIndex = slots.indexOf(targetId);
    if (targetIndex < 0) continue;
    if (Math.abs(weaponIndex - targetIndex) !== 1) continue;
    kept[weaponId] = targetId;
  }
  return kept;
}

export function matchRelation(
  rules: BattleRules,
  profession: keyof BattleRules['matrix'],
  weaponClass: keyof BattleRules['matrix'][keyof BattleRules['matrix']],
): MatchRelation {
  return rules.matrix[profession]?.[weaponClass] ?? 'none';
}

export function resolveMoraleTier(characterCount: number, rules: BattleRules): MoraleTier {
  if (characterCount <= rules.moraleNoneMaxCharacterCount) {
    return 'none';
  }
  if (characterCount <= rules.moraleFormedMaxCharacterCount) {
    return 'formed';
  }
  return 'array';
}
