import { useState } from 'react';
import type { EnhanceOption, GameAction, RunState } from '../model';
import { CARD_MAP } from '../data';
import { isCampaign, positionLabel } from '../campaign';
import { enhancementRerollCost } from '../campaign-rewards';
import { getCardRuleText } from './card-copy';
import { CardFace, Modal, OwnedCards, SKILL_NAMES, SKILL_TEXT } from './primitives';
import { PlayResult } from './play-result';

interface Props { state: RunState; send: (action: GameAction) => void; detail: (id: string) => void; charm?: (id: string) => void; }
export const moraleName = (count: number) => count >= 16 ? '列阵（军势提供威力与增幅）' : count >= 11 ? '成军（军势提供威力）' : '未成军（不积累军势）';

function EnhancementCard({ state, option, send, detail }: Props & { option: EnhanceOption }) {
  const cardId = option.targetId;
  const instance = state.cards[cardId];
  if (!instance) return null;
  const def = CARD_MAP[instance.definitionId]!;
  const copies = state.owned.filter(id => !state.removed.includes(id) && state.cards[id]!.definitionId === instance.definitionId);
  const copyLabel = copies.length > 1 ? `（同名第${copies.indexOf(cardId) + 1}张）` : '';
  const before = option.stat === 'power' ? def.power + instance.permanentPower : def.amp + instance.permanentAmp;
  return <article className="v2-reward-card">
    <span className={`v2-tier v2-tier-${option.tier}`}>{isCampaign(state) ? '随机' : option.tier === 'legendary' ? '传说' : option.tier === 'rare' ? '稀有' : '普通'}强化 · {option.stat === 'power' ? '威力' : '增幅'} +{option.amount}</span>
    <button className="v2-art-button" onClick={() => detail(cardId)}><CardFace definition={def} instance={instance} leader={state.leaderId === cardId} /></button>
    {copyLabel && <p className="v2-enhancement-target">{def.name}{copyLabel}</p>}
    <h3>{option.stat === 'power' ? '威力' : '增幅'} {before} → <em>{before + option.amount}</em></h3>
    {option.skill && <p>附加 · {SKILL_NAMES[option.skill]}：{SKILL_TEXT[option.skill]}</p>}
    <button className="v2-primary" onClick={() => send({ type: 'chooseEnhancement', optionId: option.id })}>确认强化 · {def.name}{copyLabel}</button>
  </article>;
}

export function RewardScreen({ state, send, detail }: Props) {
  const [replacement, setReplacement] = useState<string | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const first = state.reward?.first;
  const rerollCost = isCampaign(state) ? enhancementRerollCost(state) : 2;
  const active = state.owned.filter(id => !state.removed.includes(id));
  const characters = active.filter(id => CARD_MAP[state.cards[id]!.definitionId]!.type === 'character').length;
  const incoming = replacement ? CARD_MAP[replacement]! : null;
  const outgoing = replaceId ? CARD_MAP[state.cards[replaceId]!.definitionId]! : null;
  const afterCount = characters + (incoming?.type === 'character' ? 1 : 0) - (outgoing?.type === 'character' ? 1 : 0);
  return <section className="v2-route-page"><p className="v2-eyebrow">凯旋犒军 · {positionLabel(state)}告捷</p><h2>{state.phase === 'cardReward' ? first ? '名将来投' : '广纳英杰' : '百炼成锋'}</h2><p className="v2-route-intro">{state.phase === 'cardReward' ? first ? '乱世逢知己。选择一位传说名将，开启你的破阵之路。' : '纳入一张新卡，也可替换一张旧牌，保持牌组精炼。' : '随机抽出已有牌的强化候选，选择一项永久强化。每项绑定指定卡牌。'}</p>
    <div className="v2-reward-steps">{state.reward && <><b className={state.phase === 'cardReward' ? 'v2-current' : ''}>壹 · 新卡入阵</b><span>→</span></>}<b className={state.phase === 'enhanceReward' ? 'v2-current' : ''}>免费强化</b></div>
    <PlayResult report={state.battles.at(-1)?.reports.at(-1)} />
    {state.phase === 'cardReward' ? <><div className="v2-reward-grid">{state.reward?.candidates.map(id => <article className="v2-reward-card" key={id}><button className="v2-art-button" onClick={() => detail(id)} aria-label={`查看 ${CARD_MAP[id]!.name}`}><CardFace definition={CARD_MAP[id]!} /></button>{getCardRuleText(CARD_MAP[id]!) && <p>{getCardRuleText(CARD_MAP[id]!)}</p>}<button className="v2-primary" onClick={() => send({ type: 'chooseCard', definitionId: id })}>收入牌组 · {CARD_MAP[id]!.name}</button>{isCampaign(state) && <button onClick={() => { setReplacement(id); setReplaceId(null); }}>替换旧牌 · {CARD_MAP[id]!.name}</button>}</article>)}</div>{!first && <button className="v2-secondary" onClick={() => send({ type: 'chooseCard', definitionId: null })}>跳过新卡</button>}</> : <><div className="v2-reward-grid">{state.enhancements.map(option => <EnhancementCard key={option.id} state={state} option={option} send={send} detail={detail} />)}</div>{isCampaign(state) ? <div className="v2-enhancement-reroll"><button disabled={active.length <= 3 || state.gold < rerollCost} onClick={() => send({ type: 'rerollEnhancement' })}>重抽三项 · {rerollCost} 金</button><p>{active.length <= 3 ? '已展示所有可强化卡牌' : `持有 ${state.gold} 金 · 本次已重抽 ${state.enhancementRerolls} 次`}</p><small>每次重抽加价 1 金，下次奖励从 2 金重新计算。</small></div> : <button disabled={state.enhancementRerolls >= 1 || state.gold < 2} onClick={() => send({ type: 'rerollEnhancement' })}>刷新三项 · 2 金 {state.enhancementRerolls >= 1 ? '（本次已用）' : `（持有 ${state.gold} 金）`}</button>}</>}
    {replacement && incoming && <Modal title="选择替换实体" close={() => setReplacement(null)} wide>{replaceId && outgoing ? <><div className="v2-target-preview"><CardFace definition={outgoing} instance={state.cards[replaceId]!} /><div><h3>{outgoing.name} → {incoming.name}</h3><p>牌组 {active.length} → {active.length} 张 · 人物 {characters} → {afterCount} 张</p><p>下一战军势：{moraleName(characters)} → {moraleName(afterCount)}。</p><p>{state.leaderId === replaceId ? '当前先锋将失效，整军时请重新选择。' : '先锋保持当前实体。'}</p><p>被替换实体的永久强化会随旧牌离开。</p></div></div><button className="v2-primary" onClick={() => { send({ type: 'chooseCard', definitionId: replacement, replaceId }); setReplacement(null); }}>确认一换一</button><button onClick={() => setReplaceId(null)}>重新选牌</button></> : <><p>选择一张旧实体，确认后以 {incoming.name} 替换。</p><OwnedCards state={state} label="替换" onChoose={setReplaceId} /></>}<button onClick={() => setReplacement(null)}>取消替换</button></Modal>}
  </section>;
}
