import type { MatchRelation } from '@domain/models/enums';
import type { MatchHintView } from '@app/selectors';
import { PROFESSION_TEXT, RELATION_ORDER, RELATION_TEXT, WEAPON_CLASS_TEXT } from './card-face';

/**
 * 相性文案。
 *
 * 应用层只给出「档位 → 职业／兵器分类键」，译名与排版在这里完成；
 * 增幅数值读配置，界面不写死 +4 / +2 / +1。
 */

export interface MatchLine {
  readonly relation: 'main' | 'usable' | 'off';
  readonly label: string;
  readonly names: string;
  readonly ampBonus: number;
}

export function matchLines(
  hint: MatchHintView | null,
  relationAmp: Readonly<Record<MatchRelation, number>>,
): readonly MatchLine[] {
  if (hint === null) return [];
  const dict: Readonly<Record<string, string>> = hint.kind === 'weapon' ? PROFESSION_TEXT : WEAPON_CLASS_TEXT;
  const lines: MatchLine[] = [];
  for (const relation of RELATION_ORDER) {
    const keys = hint[relation];
    if (keys.length === 0) continue;
    lines.push({
      relation,
      label: RELATION_TEXT[relation],
      names: keys.map((key) => dict[key] ?? key).join('、'),
      ampBonus: relationAmp[relation] ?? 0,
    });
  }
  return lines;
}

/**
 * 卡面上的速记：本职 武者+4 · 可用 卫士+2。
 * 偏门不进卡面——那是「凑合能用」，写在详情里就够了，卡面只留最该看的一眼。
 */
export function matchSummary(lines: readonly MatchLine[]): string {
  return lines
    .filter((line) => line.relation !== 'off')
    .map((line) => `${line.label} ${line.names}+${line.ampBonus}`)
    .join(' · ');
}
