import type { ReactElement } from 'react';
import type { EnhancementCandidate } from '@domain/state/game-state';
import type { EnhancementTier } from '@domain/models/enums';
import { faceOf } from '../cards/to-face';
import { CardView } from '../cards/card-view';
import type { ScreenProps } from '../state/screen-props';

/**
 * 战后强化 · 三选一。
 *
 * 每张候选都直说三件事：加在谁身上、加什么、加多少。
 * 传说档额外附带的技能直接印在卡上，不让玩家去别处查。
 */

const TIER_TEXT: Readonly<Record<EnhancementTier, string>> = {
  common: '常',
  rare: '珍',
  legendary: '传说',
};

const TIER_CLASS: Readonly<Record<EnhancementTier, string>> = {
  common: 'reward-card--common',
  rare: 'reward-card--rare',
  legendary: 'reward-card--legendary',
};

export interface RewardScreenProps extends ScreenProps {
  readonly candidates: readonly EnhancementCandidate[];
  readonly rerollsUsed: number;
  readonly maxRerolls: number;
  readonly rerollCost: number;
  readonly skillText: (skillId: string | null) => { readonly name: string; readonly text: string } | null;
}

export function RewardScreen({
  state,
  selectors,
  ui,
  dispatch,
  candidates,
  rerollsUsed,
  maxRerolls,
  rerollCost,
  skillText,
}: RewardScreenProps): ReactElement {
  const rerollsLeft = maxRerolls - rerollsUsed;
  const canReroll = rerollsLeft > 0 && state.run.gold >= rerollCost;

  return (
    <section className="reward-screen" aria-label="战后强化">
      <div className="reward-head">
        <h2 className="panel-title">战后强化</h2>
        <p>选一项永久强化，立刻生效并带入后面两场。金币 {state.run.gold}。</p>
      </div>

      <div className="reward-grid">
        {candidates.map((candidate) => {
          const face = faceOf(state, selectors.definitions, candidate.targetInstanceId);
          const skill = skillText(candidate.skillId);
          return (
            <button
              type="button"
              key={candidate.id}
              className={
                ui.animationsEnabled
                  ? `reward-card ${TIER_CLASS[candidate.tier]} reward-card--flip`
                  : `reward-card ${TIER_CLASS[candidate.tier]}`
              }
              aria-label={`${face?.name ?? '卡牌'}，${TIER_TEXT[candidate.tier]}强化，${candidate.attribute === 'power' ? '威力' : '增幅'}增加 ${candidate.amount}`}
              onClick={() => dispatch({ type: 'ChooseEnhancement', candidateId: candidate.id })}
            >
              <span className="reward-card__tier">{TIER_TEXT[candidate.tier]} 强 化</span>
              {face !== null && <CardView face={face} variant="hand" />}
              <span className="reward-card__boost">
                {candidate.attribute === 'power' ? '威力' : '增幅'}
                <strong>+{candidate.amount}</strong>
              </span>
              {skill !== null && (
                <span className="reward-card__skill">
                  <strong>{skill.name}</strong>
                  {skill.text}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="reward-actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!canReroll}
          onClick={() => dispatch({ type: 'RerollEnhancement' })}
        >
          换一批（{rerollCost} 金币）
        </button>
        <p>
          还可换 {rerollsLeft} / {maxRerolls} 次 · 换牌只改候选，不影响已获得的强化
        </p>
      </div>

      {ui.notice !== null && ui.notice.kind === 'error' && (
        <p className="notice notice--error" role="status">{ui.notice.text}</p>
      )}
    </section>
  );
}
