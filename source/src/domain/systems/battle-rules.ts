import type { EffectiveConfig } from '@config/config-registry';
import type { MatchRelation, Profession, WeaponClass } from '../models/enums';

/**
 * 战斗规则参数。
 *
 * 全部来自配置；领域代码不得散落可平衡数字字面量。
 */
export interface BattleRules {
  readonly handLimit: number;
  readonly playCount: number;
  readonly discardCount: number;
  readonly playSlotCount: number;
  readonly maxDiscardSelection: number;
  readonly zoneBasePower: number;
  readonly zoneBaseAmp: number;
  readonly moralePowerPerPoint: number;
  readonly moraleAmpPerPoints: number;
  readonly moraleNoneMaxCharacterCount: number;
  readonly moraleFormedMaxCharacterCount: number;
  readonly relationAmp: Readonly<Record<MatchRelation, number>>;
  readonly matrix: Readonly<Record<Profession, Readonly<Record<WeaponClass, MatchRelation>>>>;
}

export function createBattleRules(config: EffectiveConfig): BattleRules {
  return {
    handLimit: config.battle.handLimit,
    playCount: config.battle.playCount,
    discardCount: config.battle.discardCount,
    playSlotCount: config.battle.playSlotCount,
    maxDiscardSelection: config.battle.maxDiscardSelection,
    zoneBasePower: config.damage.basePower,
    zoneBaseAmp: config.damage.baseAmp,
    moralePowerPerPoint: config.morale.powerPerPoint,
    moraleAmpPerPoints: config.morale.ampPerPoints,
    moraleNoneMaxCharacterCount: config.morale.noneMaxCharacterCount,
    moraleFormedMaxCharacterCount: config.morale.formedMaxCharacterCount,
    relationAmp: config.matchMatrix.relationAmp,
    matrix: config.matchMatrix.matrix,
  };
}
