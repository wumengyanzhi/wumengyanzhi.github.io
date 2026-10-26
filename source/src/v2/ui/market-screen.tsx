import { useState } from 'react';
import type { GameAction, RunState } from '../model';
import { CARD_MAP } from '../data';
import { charmDefinition, charmTier, forgeTerms, isCampaign, isRouteCharm, resaleValue, upgradeTerms } from '../campaign';
import { CardFace, CharmBar, Modal, OwnedCards } from './primitives';
import { CharmArt } from './card-art';
import { moraleName } from './reward-screen';

const tierName = (tier: number) => ['Ⅰ', 'Ⅱ', 'Ⅲ'][tier - 1];
interface Props { state: RunState; send: (action: GameAction) => void; detail: (id: string) => void; charm: (id: string) => void; }

export function MarketScreen({ state, send, detail, charm }: Props) {
  const market = state.market!;
  const [purchase, setPurchase] = useState<string | null>(null);
  const [slot, setSlot] = useState(0);
  const [service, setService] = useState<'forge' | 'remove' | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [stat, setStat] = useState<'power' | 'amp'>('power');
  const [sell, setSell] = useState<number | null>(null);
  const [upgrade, setUpgrade] = useState<number | null>(null);
  const item = market.items.find(candidate => candidate.id === purchase);
  const buying = item ? charmDefinition(state, item.definitionId, 1) : null;
  const routeSlot = isCampaign(state) && buying && isRouteCharm(buying.id) ? state.charms.findIndex(value => value && isRouteCharm(value.definitionId)) : -1;
  const old = state.charms[slot];
  const sellValue = old ? resaleValue(old) : 0;
  const removeCost = state.removalsBought + 2;
  const forge = forgeTerms(state);
  const targetDef = target ? CARD_MAP[state.cards[target]!.definitionId]! : null;
  const activeIds = state.owned.filter(id => !state.removed.includes(id));
  const characterCount = activeIds.filter(id => CARD_MAP[state.cards[id]!.definitionId]?.type === 'character').length;
  const upgrading = upgrade === null ? null : state.charms[upgrade];
  const terms = upgrade === null ? null : upgradeTerms(state, upgrade);
  const upgradeAvailable = state.charms.some((_, index) => { const quote = upgradeTerms(state, index); return quote.allowed && state.gold >= quote.cost; });
  const sellCharm = sell === null ? null : state.charms[sell];
  return <section className="v2-route-page v2-market">
    <p className="v2-eyebrow">行军小憩 · 军市 {state.marketVisits}</p><h2>军市烟火</h2><p className="v2-route-intro">以有限军资，补足下一场的锋芒。<b>现有 {state.gold} 金</b></p>
    <CharmBar state={state} send={send} inspect={charm} />
    <div className="v2-market-sell">{state.charms.map((owned, index) => owned && <button key={owned.id} onClick={() => setSell(index)}>出售 {charmDefinition(state, owned.definitionId).name} · +{resaleValue(owned)} 金</button>)}</div>
    <div className="v2-market-grid">{market.items.map(candidate => { const def = charmDefinition(state, candidate.definitionId, 1); const duplicate = state.charms.some(owned => owned?.definitionId === def.id); return <article className="v2-market-item" key={candidate.id}><CharmArt charmId={def.id} className="v2-market-art" /><p className="v2-eyebrow">常驻锦囊{isCampaign(state) ? ' · Ⅰ阶' : ''}</p><h3>{def.name}</h3><p>{def.text}</p><button className="v2-primary" disabled={candidate.sold || duplicate} onClick={() => { setPurchase(candidate.id); const route = isCampaign(state) && isRouteCharm(def.id) ? state.charms.findIndex(value => value && isRouteCharm(value.definitionId)) : -1; setSlot(route >= 0 ? route : Math.max(0, state.charms.findIndex(value => value === null))); }}>{candidate.sold ? '已售出' : duplicate ? '已持有' : `选择槽位 · ${def.price} 金`}</button></article>; })}</div>
    <button disabled={market.rerolls >= 2 || state.gold < market.rerolls + 2} onClick={() => send({ type: 'rerollMarket' })}>刷新货架 · {market.rerolls + 2} 金（{market.rerolls}/2）</button>
    <div className="v2-services">
      {isCampaign(state) && <article><span>升</span><div><h3>锦囊升阶 · 4 / 6 金</h3><p>升Ⅱ阶 4 金，升Ⅲ阶 6 金。每店一次，须先突破对应大关。</p></div><button disabled={!upgradeAvailable} onClick={() => setUpgrade(state.charms.findIndex((_, index) => { const quote = upgradeTerms(state, index); return quote.allowed && state.gold >= quote.cost; }))}>{market.upgraded ? '已升阶' : '选择升阶'}</button></article>}
      <article><span>锻</span><div><h3>定向锻造 · {forge.cost} 金</h3><p>永久 +{forge.power} 威力或 +{forge.amp} 增幅。每店一次。</p></div><button disabled={market.forged || state.gold < forge.cost} onClick={() => { setService('forge'); setTarget(null); }}>{market.forged ? '已锻造' : '选择锻造'}</button></article>
      <article><span>简</span><div><h3>精简牌组 · {removeCost} 金</h3><p>移除一张实体，调整军势与先锋。每店一次。</p></div><button disabled={market.removed || state.gold < removeCost || activeIds.length <= 1} onClick={() => { setService('remove'); setTarget(null); }}>{market.removed ? '已精简' : '选择删牌'}</button></article>
    </div>
    <button className="v2-primary v2-route-continue" onClick={() => send({ type: 'leaveMarket' })}>离开军市，整军待发 →</button>
    {purchase && buying && item && <Modal title="确认锦囊交易" close={() => setPurchase(null)}><h3>{buying.name} · {buying.price} 金</h3><p>{buying.text}</p><p>{routeSlot >= 0 ? '新路线将替换当前路线，路线乘幅最多装备一枚。' : '选择放入的固定槽位。已有锦囊将同时售出。'}取消不会扣款。</p><div className="v2-slot-picker">{state.charms.map((owned, index) => <button disabled={routeSlot >= 0 && routeSlot !== index} className={slot === index ? 'v2-selected' : ''} onClick={() => setSlot(index)} key={index}>第 {index + 1} 槽<br />{owned ? charmDefinition(state, owned.definitionId).name : '空位'}</button>)}</div><div className="v2-trade-quote"><p>旧物回收 <b>+{sellValue} 金</b></p><p>新品购入 <b>−{buying.price} 金</b></p><p>完成后余额 <strong>{state.gold + sellValue - buying.price} 金</strong></p></div><button className="v2-primary" disabled={state.gold + sellValue < buying.price} onClick={() => { send({ type: 'buyCharm', itemId: item.id, slot }); setPurchase(null); }}>确认{old ? '换购' : '购买'}</button><button onClick={() => setPurchase(null)}>取消交易</button></Modal>}
    {sell !== null && sellCharm && <Modal title="出售锦囊" close={() => setSell(null)}><p>出售 {charmDefinition(state, sellCharm.definitionId).name}，获得 {resaleValue(sellCharm)} 金。起步锦囊无法在本局重新买回。</p><button className="v2-primary" onClick={() => { send({ type: 'sellCharm', slot: sell }); setSell(null); }}>确认出售</button><button onClick={() => setSell(null)}>保留锦囊</button></Modal>}
    {upgrade !== null && <Modal title="锦囊升阶" close={() => setUpgrade(null)}><p>选择持有锦囊。升阶替换原数值，每店限一次。</p><div className="v2-slot-picker">{state.charms.map((owned, index) => { const quote = upgradeTerms(state, index); return <button key={index} disabled={!quote.allowed || state.gold < quote.cost} className={upgrade === index ? 'v2-selected' : ''} onClick={() => setUpgrade(index)}>{owned ? `${charmDefinition(state, owned.definitionId).name} ${tierName(charmTier(owned))} → ${tierName(quote.nextTier)} · ${quote.cost} 金` : '空位'}</button>; })}</div>{upgrading && terms && <><h3>{charmDefinition(state, upgrading.definitionId).name} · {tierName(charmTier(upgrading))} → {tierName(terms.nextTier)}</h3><p>当前：{charmDefinition(state, upgrading.definitionId, charmTier(upgrading)).text}</p><p>升阶后：{charmDefinition(state, upgrading.definitionId, terms.nextTier).text}</p><p>花费 {terms.cost} 金 · 完成后余额 {state.gold - terms.cost} 金</p><button className="v2-primary" disabled={!terms.allowed || state.gold < terms.cost} onClick={() => { send({ type: 'upgradeCharm', slot: upgrade }); setUpgrade(null); }}>确认升阶 · {terms.cost} 金</button></>}<button onClick={() => setUpgrade(null)}>取消升阶</button></Modal>}
    {service && <Modal title={service === 'forge' ? '定向锻造' : '精简牌组'} close={() => { setService(null); setTarget(null); }} wide>{target && targetDef ? <><div className="v2-target-preview"><CardFace definition={targetDef} instance={state.cards[target]!} /><div><h3>{targetDef.name}</h3>{service === 'forge' ? <><p>请选择符合类型的永久属性。</p><div className="v2-slot-picker">{(targetDef.type !== 'tactic' || targetDef.direction === 'power') && <button className={stat === 'power' ? 'v2-selected' : ''} onClick={() => setStat('power')}>威力 +{forge.power}</button>}{(targetDef.type === 'weapon' || targetDef.type === 'tactic' && targetDef.direction === 'amp') && <button className={stat === 'amp' ? 'v2-selected' : ''} onClick={() => setStat('amp')}>增幅 +{forge.amp}</button>}</div></> : <><p>该实体将永久离开本局牌组，不影响图鉴或下次开局。</p><p>牌组 {activeIds.length} → {activeIds.length - 1} 张 · 人物 {characterCount} → {characterCount - (targetDef.type === 'character' ? 1 : 0)} 张</p><p>下一战军势：{moraleName(characterCount)} → {moraleName(characterCount - (targetDef.type === 'character' ? 1 : 0))}。{state.leaderId === target ? '当前先锋将失效，离店后请重新选择。' : '先锋保持当前实体。'}</p></>}</div></div><button className="v2-primary" onClick={() => { send(service === 'forge' ? { type: 'forge', cardId: target, stat } : { type: 'removeCard', cardId: target }); setService(null); setTarget(null); }}>确认{service === 'forge' ? `锻造 · ${forge.cost}` : `删除 · ${removeCost}`} 金</button><button onClick={() => detail(target)}>查看完整牌面</button><button onClick={() => setTarget(null)}>重新选牌</button></> : <><p>选择一张具体实体。同名卡分别成长。</p><OwnedCards state={state} label="选择" onChoose={id => { setTarget(id); const def = CARD_MAP[state.cards[id]!.definitionId]!; setStat(def.type === 'tactic' ? def.direction! : 'power'); }} /></>}</Modal>}
  </section>;
}
