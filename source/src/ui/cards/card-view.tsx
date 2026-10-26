import type { ReactElement } from 'react';
import type { MatchRelation } from '@domain/models/enums';
import { CardGlyph } from '../icons';
import {
  CARD_TYPE_TEXT,
  FACTION_TEXT,
  PROFESSION_TEXT,
  RARITY_TEXT,
  RELATION_TEXT,
  WEAPON_CLASS_TEXT,
  cardHue,
  type CardFace,
} from './card-face';
import { matchSummary, type MatchLine } from './match-text';

/**
 * 卡面。
 *
 * 手牌、出牌框、强化候选、目标选择、详情全部复用这一个组件，只切换密度与状态。
 * 组件不做任何计算：power / amp 由外部合并好送进来。
 */

export interface CardViewProps {
  readonly face: CardFace;
  readonly variant?: 'hand' | 'slot' | 'detail';
  readonly selected?: boolean;
  readonly discardMarked?: boolean;
  readonly pendingTarget?: boolean;
  readonly positions?: readonly string[];
  /** 选中某张牌时，另一批牌上标出的相性档位（本职 +4 之类）。 */
  readonly pair?: { readonly relation: MatchRelation; readonly ampBonus: number } | null;
  /** 卡面自带的相性速查行：兵器写职业，人物写兵器。 */
  readonly match?: readonly MatchLine[];
  readonly onActivate?: (() => void) | undefined;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly testId?: string;
}

function metaText(face: CardFace): string {
  if (face.profession !== null) return `${PROFESSION_TEXT[face.profession]} · ${RARITY_TEXT[face.rarity]}`;
  if (face.weaponClass !== null) return `${WEAPON_CLASS_TEXT[face.weaponClass]} · ${RARITY_TEXT[face.rarity]}`;
  const direction = face.tacticDirection === 'power' ? '威力型' : '增幅型';
  return `${direction} · ${RARITY_TEXT[face.rarity]}`;
}

function defaultLabel(face: CardFace): string {
  const parts = [face.name, CARD_TYPE_TEXT[face.cardType], `威力 ${face.power}`, `增幅 ${face.amp}`];
  if (face.morale > 0) parts.push(`军势 ${face.morale}`);
  return parts.join('，');
}

export function CardView({
  face,
  variant = 'hand',
  selected = false,
  discardMarked = false,
  pendingTarget = false,
  positions = [],
  pair = null,
  match = [],
  onActivate,
  disabled = false,
  ariaLabel,
  testId,
}: CardViewProps): ReactElement {
  const summary = match.length === 0 ? '' : matchSummary(match);
  const classes = [
    'card',
    `card--${face.cardType}`,
    face.rarity === 'common' ? '' : 'card--rare',
    variant === 'detail' ? 'card--large' : '',
    variant === 'slot' ? 'card--compact' : '',
    discardMarked ? 'card--discard' : '',
    pendingTarget ? 'card--pending' : '',
  ]
    .filter((item) => item !== '')
    .join(' ');

  const style = { '--card-hue': String(cardHue(face.definitionId)) } as React.CSSProperties;

  const body = (
    <>
      <span className="card__crown">
        <span className="card__type" data-type={face.cardType}>
          {CARD_TYPE_TEXT[face.cardType]}
        </span>
        {face.faction !== null && (
          <span className={`card__seal card__seal--${face.faction}`} aria-hidden="true">
            {FACTION_TEXT[face.faction]}
          </span>
        )}
      </span>

      {(face.morale > 0 || face.permanentPower > 0 || face.permanentAmp > 0 || pair !== null) && (
        <span className="card__badges">
          {face.morale > 0 && <span className="chip chip--gold num">军势 {face.morale}</span>}
          {face.permanentPower > 0 && <span className="chip chip--vermilion num">威 +{face.permanentPower}</span>}
          {face.permanentAmp > 0 && <span className="chip chip--jade num">增 +{face.permanentAmp}</span>}
          {pair !== null && (
            <span className={`card__pair card__pair--${pair.relation}`} data-testid="card-pair">
              {pair.relation === 'none'
                ? '不匹配'
                : `${RELATION_TEXT[pair.relation]} +${pair.ampBonus}`}
            </span>
          )}
        </span>
      )}

      <span className="card__art">
        <CardGlyph
          kind={face.profession ?? face.weaponClass ?? 'tactic'}
        />
      </span>

      <span className="card__name">{face.name}</span>
      <span className="card__meta">{metaText(face)}</span>

      {summary !== '' && variant !== 'slot' && (
        <span className={`card__match${variant === 'detail' ? ' card__match--detail' : ''}`}>
          {variant === 'detail'
            ? match.map((line) => (
              <span className="card__match-line" key={line.relation}>
                <span className="card__match-label">{line.label}</span>
                {line.names}
                <span className="num">+{line.ampBonus}</span>
              </span>
            ))
            : summary}
        </span>
      )}

      <span className="card__stats">
        <span className={`card__stat card__stat--power${face.power !== face.basePower ? ' card__stat--boosted' : ''}`}>
          <span className="card__stat-label">威力</span>
          <span className="card__stat-value">{face.power}</span>
        </span>
        <span className={`card__stat card__stat--amp${face.amp !== face.baseAmp ? ' card__stat--boosted' : ''}`}>
          <span className="card__stat-label">增幅</span>
          <span className="card__stat-value">
            {face.cardType === 'character' && face.amp === 0 ? '—' : face.amp}
          </span>
        </span>
      </span>

      {positions.length > 0 && (
        <span className="sr-only">{positions.join('，')}</span>
      )}
    </>
  );

  if (onActivate === undefined) {
    return (
      <div className={classes} style={style} aria-label={ariaLabel ?? defaultLabel(face)}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      style={style}
      data-testid={testId}
      aria-pressed={selected}
      aria-label={ariaLabel ?? defaultLabel(face)}
      disabled={disabled}
      onClick={onActivate}
    >
      {body}
    </button>
  );
}
