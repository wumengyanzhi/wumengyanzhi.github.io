import { useState } from 'react';
import type { GameAction, RunState } from '../model';
import { charmDefinition, charmTier, isRouteCharm, positionLabel } from '../campaign';
import { CharmArt } from './card-art';
import { Modal } from './primitives';

const tierName = (tier: number) => ['Ⅰ', 'Ⅱ', 'Ⅲ'][tier - 1];

export function CharmRewardScreen({ state, send }: { state: RunState; send: (action: GameAction) => void }) {
  const [selection, setSelection] = useState<string | null>(null);
  const [slot, setSlot] = useState(0);
  const reward = state.charmReward;
  if (!reward) return null;
  const chosen = reward.candidates.find(option => option.id === selection);
  const definition = chosen ? charmDefinition(state, chosen.definitionId, chosen.tier) : null;
  const routeSlot = chosen && isRouteCharm(chosen.definitionId) ? state.charms.findIndex(charm => charm && isRouteCharm(charm.definitionId)) : -1;
  const old = chosen?.kind === 'upgrade' ? state.charms.find(charm => charm?.id === chosen.targetId) : state.charms[slot];
  return <section className="v2-route-page"><p className="v2-eyebrow">{positionLabel(state)} · {reward.kind === 'boss' ? '破关封赏' : '锦囊机缘'}</p><h2>{reward.kind === 'boss' ? '破关进阶' : '锦囊来仪'}</h2>
    {reward.baseAmp > 0 && <p className="v2-route-intro">本局基础增幅＋{reward.baseAmp}，确认领取或明确跳过锦囊时一并获得。之后每次出战生效。</p>}
    <p>选择获得或升阶一枚锦囊。加增幅做加法，乘增幅放大此前积累；锦囊按槽位从左到右生效。</p>
    <div className="v2-reward-grid">{reward.candidates.map(option => { const def = charmDefinition(state, option.definitionId, option.tier); const current = option.kind === 'upgrade' ? state.charms.find(charm => charm?.id === option.targetId) : null; return <article className="v2-reward-card v2-charm-reward-card" key={option.id}><CharmArt charmId={option.definitionId} className="v2-market-art" /><span className="v2-tier">{option.kind === 'upgrade' ? `升阶 ${current ? tierName(charmTier(current)) : ''} → ${tierName(option.tier)}` : `获得 ${tierName(option.tier)}阶`}</span><h3>{def.name}</h3><p>{def.text}</p><button className="v2-primary" onClick={() => { setSelection(option.id); const existing = isRouteCharm(option.definitionId) ? state.charms.findIndex(charm => charm && isRouteCharm(charm.definitionId)) : -1; setSlot(existing >= 0 ? existing : Math.max(0, state.charms.findIndex(charm => charm === null))); }}>选择{option.kind === 'upgrade' ? '升阶' : '获得'} · {def.name}</button></article>; })}</div>
    <button onClick={() => send({ type: 'chooseCharmReward', optionId: null })}>{reward.baseAmp > 0 ? '跳过锦囊并领取基础增幅' : '跳过锦囊奖励'}</button>
    {chosen && definition && <Modal title="确认锦囊奖励" close={() => setSelection(null)}><h3>{definition.name} · {tierName(chosen.tier)}阶</h3><p>{definition.text}</p>{chosen.kind === 'gain' ? <><p>{routeSlot >= 0 ? '新路线必须替换当前路线。' : '选择空槽，或明确替换已有锦囊。'}被替换锦囊离开本局，不获得出售金币。</p><div className="v2-slot-picker">{state.charms.map((charm, index) => <button key={index} disabled={routeSlot >= 0 && routeSlot !== index} className={slot === index ? 'v2-selected' : ''} onClick={() => setSlot(index)}>第 {index + 1} 槽<br />{charm ? `${charmDefinition(state, charm.definitionId).name} ${tierName(charmTier(charm))}` : '空位'}</button>)}</div>{old && <p>替换：{charmDefinition(state, old.definitionId).name} {tierName(charmTier(old))} → {definition.name} {tierName(chosen.tier)}</p>}</> : old && <p>当前：{charmDefinition(state, old.definitionId, charmTier(old)).text}</p>}{reward.baseAmp > 0 && <p>同时领取本局基础增幅＋{reward.baseAmp}，仅领取一次。</p>}<button className="v2-primary" onClick={() => { send(chosen.kind === 'gain' ? { type: 'chooseCharmReward', optionId: chosen.id, slot } : { type: 'chooseCharmReward', optionId: chosen.id }); setSelection(null); }}>确认领取</button><button onClick={() => setSelection(null)}>取消选择</button></Modal>}
  </section>;
}
