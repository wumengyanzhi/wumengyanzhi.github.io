import { Fragment, type ReactElement } from 'react';
import type { RunDefinitionConfig } from '@config/schemas/run.schema';

/**
 * 三场战斗进度。
 *
 * 节点顺序读自 RunDefinition，进度判断只用 battlesWon 与当前节点类型：
 * 打赢第 N 场＝前 N 个战斗节点与其后的强化节点都算「已过」，正在打的是第 N+1 个。
 */

/** 单个战斗节点的展示信息：label 印在进度条上，name 只进 aria，避免与敌人面板重复。 */
export interface RunStageLabel {
  readonly name: string;
  readonly label: string;
}

export interface RunMapProps {
  readonly run: RunDefinitionConfig;
  readonly battlesWon: number;
  readonly currentNodeId: string | null;
  readonly stages: readonly RunStageLabel[];
  readonly size: 'bar' | 'large';
}

type PipState = 'done' | 'current' | 'future';

function pipState(index: number, battlesWon: number): PipState {
  if (index < battlesWon) return 'done';
  if (index === battlesWon) return 'current';
  return 'future';
}

export function RunMap({
  run,
  battlesWon,
  currentNodeId,
  stages,
  size,
}: RunMapProps): ReactElement {
  const battleNodes = run.nodes.filter((node) => node.type === 'battle');
  const onRewardNode = currentNodeId !== null && run.nodes.some(
    (node) => node.id === currentNodeId && node.type === 'reward',
  );

  return (
    <div className={`topbar__panel panel runmap-panel ${size === 'large' ? 'runmap--lg' : ''}`}>
      <span className="panel-title">三战行程</span>
      <div
        className="runmap"
        role="list"
        aria-label={`三战行程：${stages.map((stage) => stage.name).join(' · ')}，已胜 ${battlesWon} 场`}
      >
        {battleNodes.map((node, index) => {
          const state = pipState(index, battlesWon);
          // 场景通则：能进到第 N+1 战，说明第 N 战后的强化已经走过。
          const rewardDone = index + 1 <= battlesWon;
          const rewardCurrent = onRewardNode && index === battlesWon - 1;
          const rewardState: PipState = rewardDone ? 'done' : rewardCurrent ? 'current' : 'future';
          return (
            <Fragment key={node.id}>
              <div className="runmap__node" role="listitem">
                <span className={`runmap__pip runmap__pip--${state}`}>
                  {state === 'done' ? '已破' : index + 1}
                </span>
                <span className="runmap__label">{stages[index]?.label ?? `第${index + 1}战`}</span>
              </div>
              {index < battleNodes.length - 1 && (
                <>
                  <span className={`runmap__link ${rewardDone ? 'runmap__link--current' : ''}`} aria-hidden="true" />
                  <div className="runmap__node" role="listitem">
                    <span className={`runmap__pip runmap__pip--reward runmap__pip--${rewardState}`}>
                      赏
                    </span>
                    <span className="runmap__label">强化</span>
                  </div>
                  <span
                    className={`runmap__link ${index + 1 < battlesWon ? 'runmap__link--current' : ''}`}
                    aria-hidden="true"
                  />
                </>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
