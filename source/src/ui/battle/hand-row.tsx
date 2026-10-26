import type { ReactElement } from 'react';
import type { MatchRelation } from '@domain/models/enums';
import type { InstanceId } from '@domain/models/ids';
import { CardView } from '../cards/card-view';
import type { CardFace } from '../cards/card-face';
import type { MatchLine } from '../cards/match-text';
import { useCardDrag } from '../drag/use-card-drag';

/**
 * 手牌区。
 *
 * 点卡面＝选中（下一步放进出牌框），拖卡面＝直接甩进某一格，卡下方的按钮条＝详情与弃牌标记。
 * 两条路径共存：拖过去了就不必先选后点，选错了也能继续用点击收回。
 * 被拖起来的那张要压在所有人的上面，选中态也要压过其他提示——玩家一次只看一张。
 */

export interface HandRowProps {
  readonly cards: readonly CardFace[];
  readonly selectedId: InstanceId | null;
  readonly discardIds: readonly InstanceId[];
  readonly discardRemaining: number;
  readonly maxDiscardSelection: number;
  readonly dragEnabled: boolean;
  /** 选中某一张后，其余牌上标出的相性档位：人物↔兵器互标。 */
  readonly pairs: ReadonlyMap<InstanceId, { readonly relation: MatchRelation; readonly ampBonus: number }>;
  readonly matches: ReadonlyMap<InstanceId, readonly MatchLine[]>;
  readonly onSelect: (id: InstanceId) => void;
  readonly onToggleDiscard: (id: InstanceId) => void;
  readonly onInspect: (id: InstanceId) => void;
}

interface HandCardProps {
  readonly face: CardFace;
  readonly selected: boolean;
  readonly marked: boolean;
  readonly discardBlocked: boolean;
  readonly dragEnabled: boolean;
  readonly pair: { readonly relation: MatchRelation; readonly ampBonus: number } | null;
  readonly match: readonly MatchLine[];
  readonly onSelect: (id: InstanceId) => void;
  readonly onToggleDiscard: (id: InstanceId) => void;
  readonly onInspect: (id: InstanceId) => void;
}

function HandCard({
  face,
  selected,
  marked,
  discardBlocked,
  dragEnabled,
  pair,
  match,
  onSelect,
  onToggleDiscard,
  onInspect,
}: HandCardProps): ReactElement {
  const drag = useCardDrag({
    instanceId: face.instanceId,
    source: { kind: 'hand' },
    disabled: !dragEnabled,
  });

  return (
    <div
      className={drag.status === '' ? 'hand__card' : `hand__card is-${drag.status}`}
      data-drag={drag.status === '' ? undefined : drag.status}
      style={drag.style}
      onMouseDown={drag.onMouseDown}
    >
      <CardView
        face={face}
        selected={selected}
        discardMarked={marked}
        pair={pair}
        match={match}
        testId="hand-card"
        ariaLabel={`${face.name}，威力 ${face.power}，增幅 ${face.amp}${selected ? '，已选中' : ''}${marked ? '，已标记弃牌' : ''}`}
        onActivate={() => onSelect(face.instanceId)}
      />
      <span className="hand__acts">
        <button
          type="button"
          className="hand__act"
          aria-label={`查看 ${face.name} 的详情`}
          onClick={() => onInspect(face.instanceId)}
        >
          详
        </button>
        <button
          type="button"
          className="hand__act"
          aria-pressed={marked}
          aria-label={`标记弃牌：${face.name}`}
          disabled={discardBlocked}
          onClick={() => onToggleDiscard(face.instanceId)}
        >
          弃
        </button>
      </span>
    </div>
  );
}

export function HandRow({
  cards,
  selectedId,
  discardIds,
  discardRemaining,
  maxDiscardSelection,
  dragEnabled,
  pairs,
  matches,
  onSelect,
  onToggleDiscard,
  onInspect,
}: HandRowProps): ReactElement {
  return (
    <div className="hand__row" role="group" aria-label="手牌">
      {cards.map((face) => (
        <HandCard
          key={face.instanceId}
          face={face}
          selected={selectedId === face.instanceId}
          marked={discardIds.includes(face.instanceId)}
          discardBlocked={
            !discardIds.includes(face.instanceId)
            && (discardRemaining <= 0 || discardIds.length >= maxDiscardSelection)
          }
          dragEnabled={dragEnabled}
          pair={pairs.get(face.instanceId) ?? null}
          match={matches.get(face.instanceId) ?? []}
          onSelect={onSelect}
          onToggleDiscard={onToggleDiscard}
          onInspect={onInspect}
        />
      ))}
    </div>
  );
}
