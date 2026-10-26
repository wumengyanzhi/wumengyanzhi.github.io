import type { ReactElement } from 'react';

/**
 * 资源条。
 *
 * 六个一眼可见的数字：还剩几次机会、还能换几张牌、金币与军势。
 * 军势的说明文字读自平衡配置，避免写死后与数值漂移。
 */

export interface ResourceBarProps {
  readonly playRemaining: number;
  readonly playTotal: number;
  readonly discardRemaining: number;
  readonly discardTotal: number;
  readonly handSize: number;
  readonly handLimit: number;
  readonly gold: number;
  readonly drawPile: number;
  readonly moraleTotal: number;
  readonly moralePowerPerPoint: number;
}

function Row({
  resource,
  tone,
  label,
  value,
  suffix,
  hint,
}: {
  /** 给动画用的稳定锚点：军势和弃牌长得一样，光效得能只点其中一个。 */
  readonly resource: string;
  readonly tone: string;
  readonly label: string;
  readonly value: number;
  readonly suffix?: string;
  readonly hint?: string;
}): ReactElement {
  return (
    <span className={`chip ${tone}`} data-res={resource} title={hint}>
      {label}
      <strong className="num">{value}</strong>
      {suffix ?? ''}
    </span>
  );
}

export function ResourceBar({
  playRemaining,
  playTotal,
  discardRemaining,
  discardTotal,
  handSize,
  handLimit,
  gold,
  drawPile,
  moraleTotal,
  moralePowerPerPoint,
}: ResourceBarProps): ReactElement {
  return (
    <div className="topbar__panel panel resource-panel">
      <span className="panel-title">军资</span>
      <div className="resource-bar">
        <Row
          resource="play"
          tone={playRemaining <= 1 ? 'chip--vermilion' : 'chip--indigo'}
          label="出战"
          value={playRemaining}
          suffix={`/${playTotal}`}
        />
        <Row resource="discard" tone="chip--jade" label="弃牌" value={discardRemaining} suffix={`/${discardTotal}`} />
        <Row resource="hand" tone="chip--neutral" label="手牌" value={handSize} suffix={`/${handLimit}`} />
        <Row resource="gold" tone="chip--gold" label="金币" value={gold} />
        <Row
          resource="morale"
          tone="chip--jade"
          label="军势"
          value={moraleTotal}
          hint={`每点军势为持牌提供 ${moralePowerPerPoint} 点威力`}
        />
        <Row resource="drawPile" tone="chip--neutral" label="抽牌堆" value={drawPile} />
      </div>
    </div>
  );
}
