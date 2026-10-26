import { describe, expect, it } from 'vitest';
import { generateEnhancementCandidates } from '@domain/commands/generate-enhancement';
import { rerollEnhancementCandidates } from '@domain/commands/reroll-enhancement';
import { chooseEnhancement } from '@domain/commands/choose-enhancement';
import {
  createPreparedState,
  definitions,
  effectiveConfig,
  rng,
} from '../support/domain-fixture';

describe('战后强化', () => {
  it('每次生成三个不同且不在移除区的卡牌目标', () => {
    const state = createPreparedState();
    const removed = Object.keys(state.cards)[0];
    if (removed === undefined) throw new Error('测试牌组为空');
    const prepared = {
      ...state,
      zones: { ...state.zones, removed: [removed as never] },
      cards: {
        ...state.cards,
        [removed]: { ...state.cards[removed]!, zone: 'removed' as const },
      },
    };

    const result = generateEnhancementCandidates({
      state: prepared,
      stageId: 'first_reward',
      config: effectiveConfig.enhancement,
      definitions,
      rng,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.pendingChoice?.kind).toBe('enhancement_reward');
    if (result.value.state.pendingChoice?.kind !== 'enhancement_reward') return;
    const targets = result.value.state.pendingChoice.candidates.map((candidate) => candidate.targetInstanceId);
    expect(targets).toHaveLength(3);
    expect(new Set(targets).size).toBe(3);
    expect(targets).not.toContain(removed);
    expect(result.value.state.rng.cursor).toBeGreaterThan(state.rng.cursor);
  });

  it('刷新同时替换三个候选，扣除一金币并累计刷新次数', () => {
    const generated = generateEnhancementCandidates({
      state: createPreparedState(),
      stageId: 'first_reward',
      config: effectiveConfig.enhancement,
      definitions,
      rng,
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    const result = rerollEnhancementCandidates({
      state: generated.value.state,
      config: effectiveConfig.enhancement,
      economy: effectiveConfig.economy,
      definitions,
      rng,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.run.gold).toBe(1);
    expect(result.value.state.run.rerollsUsed).toBe(1);
    expect(result.value.state.pendingChoice?.kind).toBe('enhancement_reward');
  });

  it('确认一个候选只强化对应的一张实例并清除另外两个候选', () => {
    const generated = generateEnhancementCandidates({
      state: createPreparedState(),
      stageId: 'second_reward',
      config: effectiveConfig.enhancement,
      definitions,
      rng,
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok || generated.value.state.pendingChoice?.kind !== 'enhancement_reward') return;
    const candidates = generated.value.state.pendingChoice.candidates;
    const selected = candidates[0];
    if (selected === undefined) throw new Error('没有强化候选');

    const before = generated.value.state.cards;
    const result = chooseEnhancement(generated.value.state, selected.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.pendingChoice).toBeNull();

    for (const candidate of candidates) {
      const afterCard = result.value.state.cards[candidate.targetInstanceId];
      const beforeCard = before[candidate.targetInstanceId];
      if (candidate.id === selected.id) {
        expect(afterCard).not.toEqual(beforeCard);
      } else {
        expect(afterCard).toEqual(beforeCard);
      }
    }
  });
});
