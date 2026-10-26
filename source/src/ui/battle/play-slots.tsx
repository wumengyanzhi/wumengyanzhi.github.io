import { Fragment, type ReactElement, type ReactNode } from 'react';
import type { MatchMatrix } from '@config/schemas/balance.schema';
import type { MatchRelation } from '@domain/models/enums';
import type { InstanceId } from '@domain/models/ids';
import { useDropHighlight } from '../drag/drag-context';
import { useCardDrag } from '../drag/use-card-drag';
import { CardView } from '../cards/card-view';
import { type CardFace } from '../cards/card-face';

/**
 * 五格出牌框与连营线。
 *
 * 空位必须被画出来，并明示它会隔断相邻关系——这是整套出牌规则里最容易看漏的一条。
 * 连营线的档位标签读自 matchMatrix 配置（本职 / 可用 / 偏门 / 无 + 对应增幅），
 * 界面不重算绑定规则，只把领域已经判定的结果画出来。
 */

export type LinkState =
  | { readonly kind: 'linked'; readonly relation: MatchRelation; readonly ampBonus: number }
  | { readonly kind: 'neutral' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'broken' };

const SLOT_NAMES = ['一', '二', '三', '四', '五', '六', '七'] as const;

const RELATION_SHORT: Readonly<Record<MatchRelation, string>> = {
  main: '本职',
  usable: '可用',
  off: '偏门',
  none: '不匹配',
};

const RELATION_COLOR: Readonly<Record<MatchRelation, string>> = {
  main: 'var(--gold)',
  usable: 'var(--jade)',
  off: 'var(--indigo)',
  none: 'oklch(72% 0.16 25)',
};

function findPair(
  left: CardFace,
  right: CardFace,
): { readonly weapon: CardFace; readonly target: CardFace } | null {
  if (left.cardType === 'weapon' && right.cardType === 'character') return { weapon: left, target: right };
  if (right.cardType === 'weapon' && left.cardType === 'character') return { weapon: right, target: left };
  return null;
}

/** 职业 × 兵器档位表，取自平衡配置，界面只查不判。 */
export type MatrixTable = MatchMatrix['matrix'];

export function computeLinks(
  slots: readonly (CardFace | null)[],
  awaitingTargets: readonly InstanceId[],
  matrix: MatrixTable,
  relationAmp: Readonly<Record<MatchRelation, number>>,
): readonly LinkState[] {
  const links: LinkState[] = [];
  for (let index = 0; index < slots.length - 1; index += 1) {
    const left = slots[index] ?? null;
    const right = slots[index + 1] ?? null;
    if (left === null || right === null) {
      links.push({ kind: 'broken' });
      continue;
    }
    const pair = findPair(left, right);
    if (pair === null) {
      links.push({ kind: 'neutral' });
      continue;
    }
    if (awaitingTargets.includes(pair.weapon.instanceId)) {
      links.push({ kind: 'pending' });
      continue;
    }
    links.push({ kind: 'linked', ...relationFor(pair.weapon, pair.target, matrix, relationAmp) });
  }
  return links;
}

/** 兵器配属候选上的档位与增幅，和连营线共用同一份查表口径。 */
export function relationFor(
  weapon: CardFace,
  target: CardFace,
  matrix: MatrixTable,
  relationAmp: Readonly<Record<MatchRelation, number>>,
): { readonly relation: MatchRelation; readonly ampBonus: number } {
  const profession = target.profession;
  const weaponClass = weapon.weaponClass;
  if (profession === null || weaponClass === null) return { relation: 'none', ampBonus: 0 };
  const relation = matrix[profession]?.[weaponClass] ?? 'none';
  return { relation, ampBonus: relationAmp[relation] ?? 0 };
}

function LinkView({ state, index }: { readonly state: LinkState; readonly index: number }): ReactElement {
  const testId = `play-link-${index}`;
  if (state.kind === 'linked') {
    const mismatch = state.relation === 'none';
    const style = { '--relation-color': RELATION_COLOR[state.relation] } as React.CSSProperties;
    return (
      <div
        className={`play-link play-link--linked${mismatch ? ' play-link--mismatch' : ''}`}
        data-testid={testId}
        style={style}
      >
        <span className="play-link__label">{RELATION_SHORT[state.relation]}</span>
        <span className="play-link__line" />
        <span className="play-link__value num">{state.ampBonus > 0 ? `+${state.ampBonus}` : '—'}</span>
      </div>
    );
  }
  if (state.kind === 'pending') {
    return (
      <div className="play-link play-link--pending" data-testid={testId}>
        <span className="play-link__label">待指定</span>
        <span className="play-link__line" />
        <span className="play-link__value">选目标</span>
      </div>
    );
  }
  if (state.kind === 'neutral') {
    return (
      <div className="play-link play-link--neutral" data-testid={testId}>
        <span className="play-link__label">相邻</span>
        <span className="play-link__line" />
        <span className="play-link__value">—</span>
      </div>
    );
  }
  return (
    <div className="play-link play-link--broken" data-testid={testId}>
      <span className="play-link__label">隔断</span>
      <span className="play-link__line" />
      <span className="play-link__value">—</span>
    </div>
  );
}

/**
 * 一格框：空着时是最大的落点，占着时既是可拖的牌也是自己的落点。
 * data-drop-zone 是拖拽层唯一认识它的方式，拖拽层不认 DOM 结构，只认这两个属性。
 */
function SlotFrame({ index, children }: { readonly index: number; readonly children: ReactNode }): ReactElement {
  const highlight = useDropHighlight('slot', index);
  return (
    <div
      className={highlight === '' ? 'play-slot' : `play-slot ${highlight}`}
      data-drop-zone="slot"
      data-drop-index={index}
    >
      {children}
    </div>
  );
}

function SlotCard({
  face,
  index,
  name,
  pendingTarget,
  dragEnabled,
  onRetrieve,
}: {
  readonly face: CardFace;
  readonly index: number;
  readonly name: string;
  readonly pendingTarget: boolean;
  readonly dragEnabled: boolean;
  readonly onRetrieve: () => void;
}): ReactElement {
  const drag = useCardDrag({
    instanceId: face.instanceId,
    source: { kind: 'slot', slotIndex: index },
    disabled: !dragEnabled,
  });
  return (
    <div
      className="play-slot__hold"
      data-drag={drag.status === '' ? undefined : drag.status}
      style={drag.style}
      onMouseDown={drag.onMouseDown}
    >
      <CardView
        face={face}
        variant="slot"
        testId="play-slot"
        pendingTarget={pendingTarget}
        ariaLabel={`第${name}格，${face.name}，点击收回手牌，拖动可换格`}
        onActivate={onRetrieve}
      />
    </div>
  );
}

export interface PlaySlotsProps {
  readonly slots: readonly (CardFace | null)[];
  readonly links: readonly LinkState[];
  readonly hasSelection: boolean;
  readonly awaitingTargets: readonly InstanceId[];
  readonly dragEnabled: boolean;
  readonly onPlace: (slotIndex: number) => void;
  readonly onRetrieve: (slotIndex: number) => void;
}

export function PlaySlots({
  slots,
  links,
  hasSelection,
  awaitingTargets,
  dragEnabled,
  onPlace,
  onRetrieve,
}: PlaySlotsProps): ReactElement {
  return (
    <div className="play-slots" role="group" aria-label="出牌框">
      {slots.map((face, index) => {
        const name = SLOT_NAMES[index] ?? String(index + 1);
        return (
          <Fragment key={index}>
            <SlotFrame index={index}>
              {face === null ? (
                <button
                  type="button"
                  className="play-slot__empty"
                  data-testid="play-slot"
                  aria-label={`第${name}格，空位`}
                  disabled={!hasSelection}
                  onClick={() => onPlace(index)}
                >
                  <span>空位</span>
                  <small>{hasSelection ? '点击放入' : '先选一张手牌'}</small>
                </button>
              ) : (
                <SlotCard
                  face={face}
                  index={index}
                  name={name}
                  pendingTarget={awaitingTargets.includes(face.instanceId)}
                  dragEnabled={dragEnabled}
                  onRetrieve={() => onRetrieve(index)}
                />
              )}
              <span className="play-slot__index" aria-hidden="true">{name}</span>
            </SlotFrame>
            {index < slots.length - 1 && <LinkView state={links[index] ?? { kind: 'broken' }} index={index} />}
          </Fragment>
        );
      })}
    </div>
  );
}
