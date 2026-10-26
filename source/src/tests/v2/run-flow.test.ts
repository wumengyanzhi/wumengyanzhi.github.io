import { describe, expect, it } from 'vitest';
import { act, createLegacyRun as createRun, validLeaders } from '../../v2/engine';
import { DECKS, CARD_MAP, CHARMS } from '../../v2/legacy/data';
import { parseRun, serializeRun, SAVE_KEY } from '../../v2/persistence';
import type { GameAction, RunState } from '../../v2/model';

const fresh = (seed = 'flow') => createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, seed);
function dispatch(state: RunState, action: GameAction): RunState {
  const result = act(state, action); expect(result.error).toBeNull(); expect(result.ok).toBe(true); return result.state;
}
function win(state: RunState): RunState {
  const working = structuredClone(state);
  working.battle!.hp = 1;
  const cardId = working.battle!.hand.find(id => CARD_MAP[working.cards[id]!.definitionId]!.power > 0)!;
  return dispatch(dispatch(working, { type: 'stage', cardId, slot: 0 }), { type: 'play' });
}
function reward(state: RunState): RunState {
  const selected = dispatch(state, { type: 'chooseCard', definitionId: state.reward!.first ? state.reward!.candidates[0]! : null });
  expect(new Set(selected.enhancements.map(option => option.targetId)).size).toBe(3);
  return dispatch(selected, { type: 'chooseEnhancement', optionId: selected.enhancements[0]!.id });
}
describe('V2 adventure commands', () => {
  it('starts exactly thirty independent cards with a guaranteed leader in eight cards', () => {
    const state = fresh(); expect(state.owned).toHaveLength(30); expect(state.gold).toBe(4);
    expect(state.battle!.hand).toHaveLength(8); expect(state.battle!.hand).toContain(state.leaderId);
    expect(state.charms.filter(Boolean)).toHaveLength(1); expect(state).toEqual(fresh());
    expect(state.log.reduce((n, entry) => n + entry.goldDelta, 0)).toBe(state.gold);
  });
  it('rejects invalid commands transactionally and deduplicates committed commands', () => {
    const state = fresh(); const before = serializeRun(state);
    const failure = act(state, { type: 'chooseCard', definitionId: null });
    expect(failure.ok).toBe(false); expect(failure.state).toBe(state); expect(serializeRun(state)).toBe(before);
    const next = act(state, { type: 'stage', cardId: state.battle!.hand[0]!, slot: 0 }, 'once').state;
    expect(next).not.toBe(state); expect(act(next, { type: 'play' }, 'once').state).toBe(next);
    expect(act(state, { type: 'stage', cardId: state.battle!.hand[0]!, slot: 99 }).state).toBe(state);
  });
  it('runs six battles, five card/enhancement nodes and two markets with no final loot', () => {
    let state = fresh(); let cards = 0; let enhancements = 0; let markets = 0;
    for (let battle = 0; battle < 6; battle++) {
      state = win(state);
      if (battle === 5) break;
      expect(state.phase).toBe('cardReward'); expect(state.enhancements).toHaveLength(0); cards++;
      if (battle === 0) {
        expect(state.reward!.candidates).toHaveLength(3);
        expect(state.reward!.candidates.every(id => CARD_MAP[id]!.rarity === 'legendary')).toBe(true);
        expect(act(state, { type: 'chooseCard', definitionId: null }).ok).toBe(false);
      } else {
        expect(state.reward!.candidates.map(id => CARD_MAP[id]!.type).sort()).toEqual(['character', 'tactic', 'weapon']);
      }
      state = reward(state); enhancements++;
      if (state.phase === 'market') { markets++; state = dispatch(state, { type: 'leaveMarket' }); }
      expect(state.phase).toBe('camp'); state = dispatch(state, { type: 'nextBattle' });
    }
    expect(state.phase).toBe('won'); expect(state.reward).toBeNull(); expect(state.enhancements).toHaveLength(0);
    expect([cards, enhancements, markets]).toEqual([5, 5, 2]); expect(state.battles).toHaveLength(6);
    expect(state.log.reduce((sum, entry) => sum + entry.goldDelta, 0)).toBe(state.gold);
  });
  it('saves candidates and random streams exactly and rejects forged or duplicate-zone imports', () => {
    const state = fresh(); expect(SAVE_KEY).toContain('v2'); expect(parseRun(serializeRun(state))).toEqual(state);
    const invalid = structuredClone(state); invalid.battle!.draw.push(invalid.battle!.hand[0]!);
    expect(() => parseRun(JSON.stringify(invalid))).toThrow();
    const rng = structuredClone(state); rng.rng.reward = 0; expect(() => parseRun(JSON.stringify(rng))).toThrow();
    const gold = structuredClone(state); gold.gold = -1; expect(() => parseRun(JSON.stringify(gold))).toThrow();
    const bad = structuredClone(state); bad.cards[bad.owned[0]!]!.definitionId = 'unknown'; expect(() => parseRun(JSON.stringify(bad))).toThrow();
  });
  it('replaces charms atomically using marked acquisition price, while rerolls preserve services', () => {
    let state = reward(win(fresh())); state = dispatch(state, { type: 'nextBattle' }); state = reward(win(state));
    expect(state.phase).toBe('market');
    const merchant = structuredClone(state); merchant.gold = 30; merchant.log.push({ id: 'testgrant', kind: 'test', text: '', goldDelta: 30-state.gold, battleIndex: 1 }); state = merchant;
    for (let slot = 1; slot <= 2; slot++) state = dispatch(state, { type: 'buyCharm', itemId: state.market!.items.find(item => !item.sold)!.id, slot });
    const nextItem = state.market!.items.find(item => !item.sold)!;
    const poor = structuredClone(state); poor.gold = CHARMS.find(charm => charm.id === nextItem.definitionId)!.price - 1;
    const old = poor.charms[0]!; const replaced = dispatch(poor, { type: 'buyCharm', itemId: nextItem.id, slot: 0 });
    expect(replaced.gold).toBe(poor.gold + Math.max(1,Math.floor(old.acquiredPrice/2))-CHARMS.find(charm=>charm.id===nextItem.definitionId)!.price);
    state = dispatch(state, { type: 'forge', cardId: state.owned[0]!, stat: 'power' });
    state = dispatch(state, { type: 'removeCard', cardId: state.leaderId! }); expect(state.leaderId).toBeNull();
    state = dispatch(state, { type: 'rerollMarket' }); expect(state.market!.forged).toBe(true); expect(state.market!.removed).toBe(true);
    expect(state.market!.items.every(item => !state.charms.some(charm=>charm?.definitionId===item.definitionId))).toBe(true);
    state = dispatch(state, { type: 'leaveMarket' }); expect(act(state, { type: 'nextBattle' }).ok).toBe(false);
    state = dispatch(state, { type: 'setLeader', cardId: validLeaders(state)[0]! }); expect(dispatch(state, { type: 'nextBattle' }).phase).toBe('battle');
  });
});

describe('V2 safety boundaries',()=>{
  it('keeps run-limited skill markers and excludes swallowed cards from leaders and reward targets',()=>{
    const state=fresh();const removed=state.leaderId!;state.removed.push(removed);
    state.cards[state.owned[1]!]!.used=['run:zhen_jun:0','battle-only'];
    expect(validLeaders(state)).not.toContain(removed);
    // Remove an unrelated hand/draw entity from the current battle to emulate victory consumption.
    for(const zone of [state.battle!.hand,state.battle!.draw,state.battle!.discard]){const index=zone.indexOf(removed);if(index>=0)zone.splice(index,1);}
    let next=win(state);expect(next.leaderId).toBeNull();
    expect(next.cards[state.owned[1]!]!.used).toEqual(['run:zhen_jun:0']);
    next=dispatch(next,{type:'chooseCard',definitionId:next.reward!.candidates[0]!});
    expect(next.enhancements.every(option=>option.targetId!==removed)).toBe(true);
  });
  it('round-trips every committed stage in a full reward chain',()=>{
    let state=fresh('roundtrip');
    for(let i=0;i<6;i++){
      expect(parseRun(serializeRun(state))).toEqual(state);
      state=win(state);expect(parseRun(serializeRun(state))).toEqual(state);if(i===5)break;
      state=dispatch(state,{type:'chooseCard',definitionId:state.reward!.first?state.reward!.candidates[0]!:null});
      expect(parseRun(serializeRun(state))).toEqual(state);
      state=dispatch(state,{type:'chooseEnhancement',optionId:state.enhancements[0]!.id});expect(parseRun(serializeRun(state))).toEqual(state);
      if(state.phase==='market')state=dispatch(state,{type:'leaveMarket'});
      state=dispatch(state,{type:'nextBattle'});
    }
  });
  it('permits independent copies of legendary characters at later rewards',()=>{
    let state=reward(win(fresh()));const firstLegend=state.owned.find(cardId=>CARD_MAP[state.cards[cardId]!.definitionId]!.rarity==='legendary')!;
    state=dispatch(state,{type:'nextBattle'});state=win(state);state.reward!.candidates[0]=state.cards[firstLegend]!.definitionId;
    state=dispatch(state,{type:'chooseCard',definitionId:state.cards[firstLegend]!.definitionId});
    const copies=state.owned.filter(cardId=>state.cards[cardId]!.definitionId===state.cards[firstLegend]!.definitionId);
    expect(copies).toHaveLength(2);expect(copies[0]).not.toBe(copies[1]);
  });
  it('leaves a failed purchase and rejected refresh completely unchanged',()=>{
    let state=reward(win(fresh()));state=dispatch(state,{type:'nextBattle'});state=reward(win(state));
    state.gold=0;const rng=structuredClone(state.rng);const snapshot=JSON.stringify(state);
    for(const action of [{type:'rerollMarket'},{type:'buyCharm',itemId:state.market!.items[0]!.id,slot:1}] satisfies GameAction[]){const result=act(state,action);expect(result.ok).toBe(false);expect(result.state).toBe(state);expect(JSON.stringify(state)).toBe(snapshot);expect(state.rng).toEqual(rng);}
  });
});

describe('strict V2 import validation',()=>{
  it.each([
    ['prototype definition', (state:RunState)=>{state.cards[state.owned[0]!]!.definitionId='constructor';}],
    ['forged maximum HP', (state:RunState)=>{state.battle!.maxHp=999999;}],
    ['impossible repeat skill', (state:RunState)=>{state.cards[state.owned[0]!]!.enhancementSkills=['hui_xiang'];state.cards[state.owned[0]!]!.chain=true;}],
    ['identifier counter collision', (state:RunState)=>{state.nextId=1;}],
    ['false market count', (state:RunState)=>{state.marketVisits=2;}],
    ['fake current report count', (state:RunState)=>{state.battle!.completedPlays=1;state.battle!.playsLeft=3;}],
  ] as const)('rejects %s',(_name,corrupt)=>{const state=fresh();corrupt(state);expect(()=>parseRun(JSON.stringify(state))).toThrow();});
});

describe('choice invalidation',()=>{
  it('clears a selected hand-discard skill target if that card is actively discarded',()=>{
    const deck=DECKS.find(item=>item.leaders.some(id=>CARD_MAP[id]!.skill==='sun_shang_xiang'))!;
    let state=createRun(deck.id,deck.leaders.find(id=>CARD_MAP[id]!.skill==='sun_shang_xiang')!,'choice');
    let weapon=state.battle!.hand.find(id=>CARD_MAP[state.cards[id]!.definitionId]!.type==='weapon');
    if(!weapon){weapon=state.battle!.draw.find(id=>CARD_MAP[state.cards[id]!.definitionId]!.type==='weapon')!;const last=state.battle!.hand.pop()!;state.battle!.draw.splice(state.battle!.draw.indexOf(weapon),1,last);state.battle!.hand.push(weapon);}
    state=dispatch(state,{type:'stage',cardId:state.leaderId!,slot:0});
    state=dispatch(state,{type:'target',key:`skill:${state.leaderId}`,targetId:weapon});
    state=dispatch(state,{type:'discard',cardIds:[weapon]});
    // The discarded card can legitimately be redrawn, otherwise its choice must disappear.
    expect(()=>serializeRun(state)).not.toThrow();
    if(!state.battle!.hand.includes(weapon))expect(state.battle!.targets[`skill:${state.leaderId}`]).toBeUndefined();
  });
  it('does not accept equipment keys as generic skill targets',()=>{
    const state=fresh();expect(act(state,{type:'target',key:'equip:any',targetId:state.leaderId!}).ok).toBe(false);
  });
});

describe('published difficulty and complete save zones',()=>{
  it('uses fifteen percent more enemy HP for elite without changing reward rules',()=>{
    const standard=fresh('elite');const elite=createRun(DECKS[0]!.id,DECKS[0]!.leaders[0]!,'elite','elite');
    expect(elite.battle!.maxHp).toBe(Math.ceil(standard.battle!.maxHp*1.15));expect(elite.gold).toBe(standard.gold);expect(()=>serializeRun(elite)).not.toThrow();
  });
  it('rejects a save silently missing an active card from all zones',()=>{
    const state=fresh();state.battle!.draw.pop();expect(()=>parseRun(JSON.stringify(state))).toThrow();
  });
  it('rejects forged enhancement amounts and unsafe or duplicate attached skills',()=>{
    let state=win(fresh());state=dispatch(state,{type:'chooseCard',definitionId:state.reward!.candidates[0]!});
    const amount=structuredClone(state);amount.enhancements[0]!.amount=99;expect(()=>parseRun(JSON.stringify(amount))).toThrow();
    const unsafe=structuredClone(state);unsafe.enhancements[0]!.tier='common';unsafe.enhancements[0]!.skill='hui_xiang';expect(()=>parseRun(JSON.stringify(unsafe))).toThrow();
  });
  it('rejects an unknown forge stat without taking money',()=>{
    let state=reward(win(fresh()));state=dispatch(state,{type:'nextBattle'});state=reward(win(state));
    const weapon=state.owned.find(cardId=>CARD_MAP[state.cards[cardId]!.definitionId]!.type==='weapon')!;
    expect(act(state,{type:'forge',cardId:weapon,stat:'unknown'} as unknown as GameAction).state).toBe(state);
  });
});

describe('reward and terminal import regression cases',()=>{
  const secondReward=()=>win(dispatch(reward(win(fresh('reward-import'))),{type:'nextBattle'}));
  it.each([1,2])('rejects a later reward with only %s candidates',count=>{
    const state=secondReward();state.reward!.candidates=state.reward!.candidates.slice(0,count);
    expect(()=>parseRun(JSON.stringify(state))).toThrow('存档无效');
  });
  it('rejects common candidates and second-battle legendary candidates',()=>{
    const state=secondReward();
    const common=structuredClone(state);const type=CARD_MAP[common.reward!.candidates[0]!]!.type;
    common.reward!.candidates[0]=Object.values(CARD_MAP).find(card=>card.type===type&&card.rarity==='common')!.id;
    expect(()=>parseRun(JSON.stringify(common))).toThrow('存档无效');
    const legendary=structuredClone(state);legendary.reward!.candidates[0]=Object.values(CARD_MAP).find(card=>card.rarity==='legendary')!.id;
    expect(()=>parseRun(JSON.stringify(legendary))).toThrow('存档无效');
  });
  it('rejects a lost phase backed by an entirely victorious history',()=>{
    const state=win(fresh());state.phase='lost';state.reward=null;
    expect(()=>parseRun(JSON.stringify(state))).toThrow('存档无效');
  });
  it('rejects missing enhancement candidates while three active targets exist',()=>{
    let state=win(fresh());state=dispatch(state,{type:'chooseCard',definitionId:state.reward!.candidates[0]!});
    state.enhancements.pop();expect(()=>parseRun(JSON.stringify(state))).toThrow('存档无效');
  });
  it('rejects an incomplete fixed-pool market inventory',()=>{
    const state=reward(secondReward());state.market!.items.pop();expect(()=>parseRun(JSON.stringify(state))).toThrow('存档无效');
  });
});

describe('valid terminal and later reward saves',()=>{
  it('round-trips a genuine exhausted four-play loss',()=>{
    let state=fresh('actual-loss');
    while(state.phase==='battle'){
      const cardId=state.battle!.hand.find(id=>CARD_MAP[state.cards[id]!.definitionId]!.type==='character')??state.battle!.hand[0]!;
      state=dispatch(state,{type:'stage',cardId,slot:0});state=dispatch(state,{type:'play'});
    }
    expect(state.phase).toBe('lost');expect(state.battles.at(-1)!.won).toBe(false);expect(parseRun(serializeRun(state))).toEqual(state);
  });
  it('accepts later legendary characters while rejecting common rewards in every later act',()=>{
    let state=fresh('later-rarity');
    const legendary=Object.values(CARD_MAP).find(card=>card.rarity==='legendary')!.id;
    const common=Object.values(CARD_MAP).find(card=>card.type==='character'&&card.rarity==='common')!.id;
    for(let battle=0;battle<5;battle++){
      state=win(state);
      if(battle>=2){
        const allowed=structuredClone(state);allowed.reward!.candidates[0]=legendary;expect(parseRun(serializeRun(allowed))).toEqual(allowed);
        const invalid=structuredClone(state);invalid.reward!.candidates[0]=common;expect(()=>parseRun(JSON.stringify(invalid))).toThrow('存档无效');
      }
      state=reward(state);if(state.phase==='market')state=dispatch(state,{type:'leaveMarket'});state=dispatch(state,{type:'nextBattle'});
    }
  });
});
