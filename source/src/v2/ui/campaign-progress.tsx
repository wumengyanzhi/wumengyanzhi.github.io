import type { RunState } from '../model';
import { chapterIndex, enemiesFor, isCampaign, positionLabel } from '../campaign';

export function CampaignProgress({ state }: { state: RunState }) {
  const enemies = enemiesFor(state);
  const campaign = isCampaign(state);
  const chapter = chapterIndex(state);
  const start = campaign ? chapter * 6 : 0;
  return <nav className={`v2-progress ${campaign ? 'v2-campaign-progress' : ''}`} aria-label={campaign ? '三大关行程' : '六战行程'}>
    {campaign && <div className="v2-chapter-steps">{['一', '二', '三'].map((name, index) => <b key={name} aria-current={index === chapter ? 'step' : undefined} className={index === chapter ? 'v2-current' : index < chapter ? 'v2-done' : ''}>第{name}关</b>)}</div>}
    <div className="v2-battle-steps">{enemies.slice(start, start + 6).map((enemy, offset) => {
      const index = start + offset;
      return <span data-battle-step key={enemy.id} className={index === state.battleIndex ? 'v2-current' : index < state.battleIndex ? 'v2-done' : ''} aria-current={index === state.battleIndex ? 'step' : undefined} aria-label={`${positionLabel(state, index)} ${enemy.name}${index === state.battleIndex ? ' 当前' : ''}`}>{index < state.battleIndex ? '✓' : offset + 1}</span>;
    })}</div>
  </nav>;
}

export function ChapterBoss({ state, index = state.battleIndex, expanded = false }: { state: RunState; index?: number; expanded?: boolean }) {
  if (!isCampaign(state)) return null;
  const boss = enemiesFor(state)[Math.floor(index / 6) * 6 + 5];
  if (!boss) return null;
  return <details open={expanded || undefined} className="v2-chapter-boss"><summary>本关首领 · {boss.name} · 规则说明</summary><p>{boss.text}</p></details>;
}
