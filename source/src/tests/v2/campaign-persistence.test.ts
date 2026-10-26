import { describe, expect, it } from 'vitest';
import { CARD_MAP, DECKS } from '../../v2/data';
import { act, createRun, createLegacyRun } from '../../v2/engine';
import { parseRun, serializeRun } from '../../v2/persistence';
import type { GameAction, RunState } from '../../v2/model';
import { cloneRun } from '../../v2/model';
import { createCharmReward } from '../../v2/campaign-rewards';

export function walkCampaign(onState: (s: RunState)=>void = ()=>{}): RunState {
  let s=createRun(DECKS[0]!.id,DECKS[0]!.leaders[0]!,'all-phases');
  for(const c of Object.values(s.cards))c.permanentPower=100000;
  const commit=(a:GameAction)=>{const r=act(s,a,`test-${s.revision}`);expect(r.error).toBeFalsy();expect(r.ok).toBe(true);s=r.state;onState(s);};
  onState(s);
  for(let n=0;n<200&&s.phase!=='won';n++){
    if(s.phase==='battle'){const id=s.battle!.hand.find(id=>CARD_MAP[s.cards[id]!.definitionId]!.type==='character')!;commit({type:'stage',cardId:id,slot:2});commit({type:'play'});}
    else if(s.phase==='cardReward')commit({type:'chooseCard',definitionId:s.reward!.first?s.reward!.candidates[0]!:null});
    else if(s.phase==='enhanceReward'){const e=s.enhancements[0]!;commit({type:'chooseEnhancement',optionId:e.id,cardId:e.targetId});}
    else if(s.phase==='charmReward'){const o=s.charmReward!.candidates.find(o=>o.kind==='upgrade')??s.charmReward!.candidates[0]!;commit({type:'chooseCharmReward',optionId:o.id});}
    else if(s.phase==='market')commit({type:'leaveMarket'});
    else if(s.phase==='camp')commit({type:'nextBattle'});
    else throw new Error(`unexpected ${s.phase}`);
  }
  expect(s.phase).toBe('won');return s;
}

describe('campaign persistence and progression',()=>{
  it('roundtrips each action through all 18 battles, including fractional reports and reward phases',()=>{
    const seen=new Set<string>();
    const s=walkCampaign(state=>{expect(parseRun(serializeRun(state))).toEqual(state);seen.add(state.phase);});
    expect(s.battles).toHaveLength(18);expect(s.marketVisits).toBe(6);expect(s.baseAmp).toBe(10);expect(s.charmReward).toBeNull();
    expect(seen.has('charmReward')).toBe(true);
  });
  it('continues old six-battle saves without changing content version or old charm values',()=>{
    const s=createLegacyRun(DECKS[0]!.id,DECKS[0]!.leaders[0]!,'legacy');
    expect(parseRun(serializeRun(s))).toEqual(s);expect(s.battle!.maxHp).toBeLessThan(2400);expect(s.charms[0]!.tier).toBeUndefined();
  });
  it('rejects route stacking, skipped tiers and unearned boss amp',()=>{
    const s=createRun(DECKS[0]!.id,DECKS[0]!.leaders[0]!,'tamper');
    s.baseAmp=10;expect(()=>parseRun(JSON.stringify(s))).toThrow();s.baseAmp=0;
    s.charms[0]!.tier=3;expect(()=>parseRun(JSON.stringify(s))).toThrow();s.charms[0]!.tier=1;
    s.charms[1]={id:`charm-${s.nextId++}`,definitionId:'three_kingdoms.charm.shuang_feng_jun_yin',tier:1,acquiredPrice:0};
    s.charms[2]={id:`charm-${s.nextId++}`,definitionId:'three_kingdoms.charm.zhou_liu_chou',tier:1,acquiredPrice:0};
    expect(()=>parseRun(JSON.stringify(s))).toThrow();
  });
  it('offers exactly 17 free enhancements, 9 card nodes, 3 milestone charms, 2 boss rewards and 6 markets',()=>{
    const nodes=new Map<string,Set<number>>();
    walkCampaign(s=>{const key=s.phase==='charmReward'?s.charmReward!.kind:s.phase;if(!nodes.has(key))nodes.set(key,new Set());nodes.get(key)!.add(s.battleIndex);});
    expect(nodes.get('enhanceReward')?.size).toBe(17);expect(nodes.get('cardReward')?.size).toBe(9);
    expect(nodes.get('milestone')?.size).toBe(3);expect(nodes.get('boss')?.size).toBe(2);expect(nodes.get('market')?.size).toBe(6);
  });
  it('commits boss rewards once, grants the base amp on skip, and rejects an invalid route slot atomically',()=>{
    let boss!:RunState;walkCampaign(s=>{if(s.phase==='charmReward'&&s.battleIndex===5)boss=s;});
    const switchRoute=boss.charmReward!.candidates.find(o=>o.kind==='gain')!;
    const before=JSON.stringify(boss),routeSlot=boss.charms.findIndex(c=>c?.id===boss.charmReward!.routeAtVictory);
    const rejected=act(boss,{type:'chooseCharmReward',optionId:switchRoute.id,slot:(routeSlot+1)%3});
    expect(rejected.ok).toBe(false);expect(rejected.state).toBe(boss);expect(JSON.stringify(boss)).toBe(before);expect(boss.baseAmp).toBe(0);
    const accepted=act(boss,{type:'chooseCharmReward',optionId:null},'boss-once');expect(accepted.ok).toBe(true);expect(accepted.state.baseAmp).toBe(4);
    expect(act(accepted.state,{type:'chooseCharmReward',optionId:null},'boss-once').state).toBe(accepted.state);
    expect(act(accepted.state,{type:'chooseCharmReward',optionId:null},'boss-twice').ok).toBe(false);
    expect(parseRun(serializeRun(accepted.state)).baseAmp).toBe(4);
  });
  it('keeps boss route upgrades sequential and applies the missing-route guarantee',()=>{
    let boss!:RunState;walkCampaign(s=>{if(s.phase==='charmReward'&&s.battleIndex===11)boss=s;});
    const copy=cloneRun(boss),route=copy.charms.find(c=>c?.id===copy.charmReward!.routeAtVictory)!;route.tier=1;
    createCharmReward(copy,'boss');expect(copy.charmReward!.candidates.find(o=>o.kind==='upgrade')!.tier).toBe(2);
    copy.charms=copy.charms.map(c=>c?.id===route.id?null:c);createCharmReward(copy,'boss');
    expect(copy.charmReward!.candidates.every(o=>o.kind==='gain'&&o.tier===2)).toBe(true);
    copy.battleIndex=5;createCharmReward(copy,'boss');expect(copy.charmReward!.candidates.every(o=>o.tier===2)).toBe(true);
  });
  it('charges the chapter forge terms, enforces one upgrade per store, and rejects malformed forge attributes',()=>{
    let market!:RunState;walkCampaign(s=>{if(s.phase==='market'&&s.battleIndex===13)market=s;});
    const weapon=market.owned.find(id=>!market.removed.includes(id)&&CARD_MAP[market.cards[id]!.definitionId]!.type==='weapon')!;
    const illegal=act(market,{type:'forge',cardId:weapon,stat:'bad'} as unknown as GameAction);expect(illegal.ok).toBe(false);expect(illegal.state).toBe(market);
    const forged=act(market,{type:'forge',cardId:weapon,stat:'amp'});expect(forged.ok).toBe(true);expect(forged.state.gold).toBe(market.gold-5);expect(forged.state.cards[weapon]!.permanentAmp).toBe(market.cards[weapon]!.permanentAmp+6);
    const before=market.charms[0]!,cost=before.tier===1?4:6,up=act(market,{type:'upgradeCharm',slot:0});expect(up.ok).toBe(true);expect(up.state.gold).toBe(market.gold-cost);expect(up.state.charms[0]!.acquiredPrice).toBe(before.acquiredPrice+cost);
    expect(act(up.state,{type:'upgradeCharm',slot:0}).ok).toBe(false);expect(parseRun(serializeRun(up.state))).toEqual(up.state);
  });
});
