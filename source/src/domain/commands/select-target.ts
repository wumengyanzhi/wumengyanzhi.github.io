import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { CardDefinition } from '../models/card-definition';
import type { DefinitionId, InstanceId } from '../models/ids';
import type { PlaySlot } from '../models/zone';
import type { CardInstanceMap } from '../state/game-state';

/**
 * 装备目标选择。
 *
 * 武器只有一侧紧邻人物时自动装备；两侧均为人物时必须由玩家在点击出战前指定。
 */

export interface WeaponTargetCandidates {
  readonly weaponInstanceId: InstanceId;
  readonly candidateInstanceIds: readonly InstanceId[];
}

export function findWeaponsNeedingTarget(
  slots: readonly PlaySlot[],
  cards: CardInstanceMap,
  definitions: ReadonlyMap<DefinitionId, CardDefinition>,
): readonly WeaponTargetCandidates[] {
  const result: WeaponTargetCandidates[] = [];

  for (let index = 0; index < slots.length; index += 1) {
    const weaponInstanceId = slots[index];
    if (weaponInstanceId === null || weaponInstanceId === undefined) {
      continue;
    }
    const weapon = cards[weaponInstanceId];
    const weaponDefinition = weapon === undefined ? undefined : definitions.get(weapon.definitionId);
    if (weapon === undefined || weaponDefinition?.cardType !== 'weapon') {
      continue;
    }

    const neighbours: InstanceId[] = [];
    for (const candidateId of [slots[index - 1], slots[index + 1]]) {
      if (candidateId === null || candidateId === undefined) {
        continue;
      }
      const candidate = cards[candidateId];
      const definition = candidate === undefined ? undefined : definitions.get(candidate.definitionId);
      if (definition?.cardType === 'character') {
        neighbours.push(candidateId);
      }
    }

    if (neighbours.length > 1) {
      result.push({ weaponInstanceId, candidateInstanceIds: neighbours });
    }
  }

  return result;
}

export function selectWeaponTarget(
  candidates: readonly WeaponTargetCandidates[],
  weaponInstanceId: InstanceId,
  targetInstanceId: InstanceId,
): Result<InstanceId, AppError> {
  const candidate = candidates.find((entry) => entry.weaponInstanceId === weaponInstanceId);
  if (candidate === undefined) {
    return err(createAppError(AppErrorCode.InvalidCommand, '该武器不需要选择装备目标', { weaponInstanceId }));
  }
  if (!candidate.candidateInstanceIds.includes(targetInstanceId)) {
    return err(createAppError(AppErrorCode.InvalidCommand, '装备目标不是该武器的相邻人物', { weaponInstanceId }));
  }
  return ok(targetInstanceId);
}
