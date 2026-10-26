import type { CardDefinition } from '../models/card-definition';
import type { DefinitionId, InstanceId } from '../models/ids';
import type { MoraleTier } from '../models/enums';
import { effectiveAmp, effectivePower } from '../models/card-instance';
import type { CardInstanceMap } from '../state/game-state';
import type { BattleRules } from './battle-rules';
import type { EquipBinding } from './weapon-matching';
import { emitTrace, type TracePort } from '../diagnostics/trace';

/**
 * 伤害结算。
 *
 * 最终伤害 = 威力总值 × 增幅总值；不存在隐藏的第三乘区。
 * 本次出战的技能效果由阶段 5 的效果系统写入实例的本次加成，这里只做汇总。
 */

export interface DamageInput {
  readonly trace?: TracePort;
  readonly participantIds: readonly InstanceId[];
  readonly cards: CardInstanceMap;
  readonly definitions: ReadonlyMap<DefinitionId, CardDefinition>;
  readonly bindings: readonly EquipBinding[];
  readonly moraleTotal: number;
  readonly moraleTier: MoraleTier;
  readonly rules: BattleRules;
  readonly zonePowerBonus?: number;
  readonly zoneAmpBonus?: number;
}

export interface DamageBreakdown {
  readonly powerTotal: number;
  readonly ampTotal: number;
  readonly moralePower: number;
  readonly moraleAmp: number;
  readonly matchAmp: number;
  readonly damage: number;
}

export function calculateDamage(input: DamageInput): DamageBreakdown {
  let powerTotal = input.rules.zoneBasePower;
  let ampTotal = input.rules.zoneBaseAmp;
  emitTrace(input.trace, { kind: 'power', source: 'zone', label: '威力起始值', timing: 'damage', before: 0, after: powerTotal });
  emitTrace(input.trace, { kind: 'amp', source: 'zone', label: '增幅起始值', timing: 'damage', before: 0, after: ampTotal });

  for (const instanceId of input.participantIds) {
    const instance = input.cards[instanceId];
    const definition = instance === undefined ? undefined : input.definitions.get(instance.definitionId);
    if (instance === undefined || definition === undefined) {
      continue;
    }
    // 人物没有基础增幅，武器与战术按定义提供；两者的本次加成都来自实例。
    const definitionAmp = definition.cardType === 'character' ? 0 : definition.baseAmp;
    const beforePower = powerTotal;
    const beforeAmp = ampTotal;
    powerTotal += definition.basePower + effectivePower(instance);
    ampTotal += definitionAmp + effectiveAmp(instance);
    emitTrace(input.trace, { kind: 'power', source: instanceId, label: definition.name, timing: 'damage', before: beforePower, after: powerTotal, detail: `基础 ${definition.basePower}；永久 ${instance.permanentPower}；本场 ${instance.battleTemporaryPower}；本手 ${instance.thisPlayPower}` });
    emitTrace(input.trace, { kind: 'amp', source: instanceId, label: definition.name, timing: 'damage', before: beforeAmp, after: ampTotal, detail: `基础 ${definitionAmp}；永久 ${instance.permanentAmp}；本场 ${instance.battleTemporaryAmp}；本手 ${instance.thisPlayAmp}` });
  }

  let matchAmp = 0;
  for (const binding of input.bindings) {
    matchAmp += binding.ampBonus;
  }
  ampTotal += matchAmp;
  emitTrace(input.trace, { kind: 'amp', source: 'equipment', label: '装备匹配', timing: 'damage', before: ampTotal - matchAmp, after: ampTotal, detail: input.bindings.map((b)=>`${b.weaponInstanceId} → ${b.targetInstanceId}：${b.relation} +${b.ampBonus}`).join('；') });

  const moralePower =
    input.moraleTier === 'none' ? 0 : input.moraleTotal * input.rules.moralePowerPerPoint;
  const moraleAmp =
    input.moraleTier === 'array'
      ? Math.floor(input.moraleTotal / input.rules.moraleAmpPerPoints)
      : 0;

  powerTotal += moralePower;
  ampTotal += moraleAmp;
  emitTrace(input.trace, { kind: 'power', source: 'morale', label: '军势威力', timing: 'damage', before: powerTotal - moralePower, after: powerTotal, detail: `${input.moraleTier} / ${input.moraleTotal} 点` });
  emitTrace(input.trace, { kind: 'amp', source: 'morale', label: '军势增幅', timing: 'damage', before: ampTotal - moraleAmp, after: ampTotal });
  powerTotal += input.zonePowerBonus ?? 0;
  ampTotal += input.zoneAmpBonus ?? 0;
  emitTrace(input.trace, { kind: 'power', source: 'effects', label: '技能威力区合计', timing: 'damage', before: powerTotal - (input.zonePowerBonus ?? 0), after: powerTotal });
  emitTrace(input.trace, { kind: 'amp', source: 'effects', label: '技能增幅区合计', timing: 'damage', before: ampTotal - (input.zoneAmpBonus ?? 0), after: ampTotal });

  return {
    powerTotal,
    ampTotal,
    moralePower,
    moraleAmp,
    matchAmp,
    damage: powerTotal * ampTotal,
  };
}
