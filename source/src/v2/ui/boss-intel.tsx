import { useId } from 'react';
import { CARD_MAP } from '../data';
import { enemiesFor, isCampaign } from '../campaign';
import type { EnemyDef, RunState } from '../model';

function penaltyActive(state: RunState, enemy: EnemyDef): boolean | null {
  const slots = state.battle?.slots ?? [];
  const character = (slot: number) => !!slots[slot] && CARD_MAP[state.cards[slots[slot]!]!.definitionId]?.type === 'character';
  if (enemy.rule === 'campaign_center') return !character(2);
  if (enemy.rule === 'campaign_empty_second') return !!slots[1];
  if (enemy.rule === 'campaign_wings') return !character(0) || !character(4);
  return null;
}

export function BossIntel({ state, index = state.battleIndex, live = false, compact = false, onInspect }: { state: RunState; index?: number; live?: boolean; compact?: boolean; onInspect?: () => void }) {
  const ruleId = useId();
  const enemies = enemiesFor(state);
  const boss = isCampaign(state) ? enemies[Math.floor(index / 6) * 6 + 5] : enemies.slice(index).find(enemy => enemy.kind === 'boss');
  if (!boss) return <section className="v2-boss-intel v2-intel-empty" aria-label="首领战前情报">此程暂无首领情报</section>;
  const current = live && enemies[index]?.id === boss.id;
  const active = current ? penaltyActive(state, boss) : null;
  const status = current ? active === null ? '首领技能' : active ? '削弱生效' : '已规避削弱' : `第${isCampaign(state) ? 6 : enemies.indexOf(boss) + 1}${isCampaign(state) ? '局' : '战'} · BOSS`;
  const Tag = onInspect ? 'button' : 'div';
  return <section className={`v2-boss-intel ${current ? 'v2-intel-live' : 'v2-intel-upcoming'} ${active === false ? 'v2-intel-avoided' : ''} ${compact ? 'v2-intel-compact' : ''}`} data-boss-state={current ? active === false ? 'avoided' : 'active' : 'upcoming'} aria-label={current ? '首领技能' : '首领战前情报'}>
    <Tag className="v2-boss-intel-main" onClick={onInspect} aria-label={onInspect ? '查看首领情报与行程' : undefined} aria-describedby={onInspect ? ruleId : undefined}>
      <div className="v2-intel-heading"><strong>{current ? 'BOSS 技能' : '本关首领预告'} · {boss.name}</strong><span>{status}</span></div>
      <p id={ruleId}>{boss.text}</p>
    </Tag>
  </section>;
}
