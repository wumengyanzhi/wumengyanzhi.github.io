import type { ReactElement } from 'react';
import type { MatchRelation } from '@domain/models/enums';
import type { InstanceId } from '@domain/models/ids';
import { RELATION_TEXT, type CardFace } from '../cards/card-face';
import { CardView } from '../cards/card-view';
import { ArrowGlyph } from '../icons';
import { Dialog } from './choice-dialog';

/**
 * 兵器配属。
 *
 * 武器左右都是人物时才需要玩家指定；这里把两个候选连同匹配档位一起摊开，
 * 让玩家看到「选他会拿到多少增幅」，而不是猜。
 */

export interface TargetOption {
  readonly face: CardFace;
  readonly relation: MatchRelation;
  readonly ampBonus: number;
}

export interface WeaponTargetDialogProps {
  readonly weapon: CardFace;
  readonly options: readonly TargetOption[];
  readonly onPick: (targetInstanceId: InstanceId) => void;
  readonly onClose: () => void;
}

const TONE: Readonly<Record<MatchRelation, string>> = {
  main: 'chip--gold',
  usable: 'chip--jade',
  off: 'chip--indigo',
  none: 'chip--neutral',
};

export function WeaponTargetDialog({
  weapon,
  options,
  onPick,
  onClose,
}: WeaponTargetDialogProps): ReactElement {
  return (
    <Dialog
      title="兵器配属"
      subtitle={`${weapon.name} 两侧都是人物，请指定归属`}
      onClose={onClose}
    >
      <div className="target-picker">
        <p className="preview__empty">
          这件兵器左右相邻都是人物，请指定它归属于其中一位。选定后本次结算按该组合计入增幅。
        </p>
        <div className="target-picker__row">
          <CardView face={weapon} variant="detail" />
          <span className="target-picker__arrow" aria-hidden="true">
            <ArrowGlyph />
            <small>配属</small>
          </span>
          {options.map((option) => (
            <button
              type="button"
              className="target-option"
              key={option.face.instanceId}
              aria-label={`配属给 ${option.face.name}，${RELATION_TEXT[option.relation]}，增幅 +${option.ampBonus}`}
              onClick={() => onPick(option.face.instanceId)}
            >
              <CardView face={option.face} variant="detail" />
              <span className={`chip ${TONE[option.relation]}`}>
                {RELATION_TEXT[option.relation]} · 增幅 +{option.ampBonus}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
