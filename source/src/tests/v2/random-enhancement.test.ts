import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_MAP, DECKS } from '../../v2/data';
import { act, createRun } from '../../v2/engine';
import { createEnhancements } from '../../v2/campaign-rewards';
import { parseRun, serializeRun } from '../../v2/persistence';
import type { GameAction, RunState } from '../../v2/model';

const fresh=(seed='random-rewards')=>createRun(DECKS[0]!.id,DECKS[0]!.leaders[0]!,seed);
function commit(s:RunState,a:GameAction,receipt?:string):RunState{const r=act(s,a,receipt);expect(r.error).toBeNull();expect(r.ok).toBe(true);return r.state;}
function pending(seed?:string):RunState{
  let s=fresh(seed);s.cards[s.leaderId!]!.permanentPower=10000;
  s=commit(s,{type:'stage',cardId:s.leaderId!,slot:2});s=commit(s,{type:'play'});
  return commit(s,{type:'chooseCard',definitionId:s.reward!.candidates[0]!});
}
const oldJson=readFileSync(new URL('../fixtures/campaign-v040-enhancement.json',import.meta.url),'utf8');

describe('random three-choice enhancements',()=>{
  it('draws three distinct fixed targets from the active deck with chapter-scaled legal stats',()=>{
    for(const chapter of [0,1,2]){
      const s=fresh(`chapter-${chapter}`);s.battleIndex=chapter*6;s.removed.push(s.owned[0]!);createEnhancements(s);
      expect(s.enhancements).toHaveLength(3);expect(new Set(s.enhancements.map(o=>o.targetId)).size).toBe(3);
      for(const o of s.enhancements){const d=CARD_MAP[s.cards[o.targetId]!.definitionId]!;expect(s.removed).not.toContain(o.targetId);expect(o.targetIds).toBeUndefined();expect(o.skill).toBeNull();expect(o.stat).toBe(d.type==='character'||d.direction==='power'?'power':'amp');expect(o.amount).toBe((chapter+1)*(o.stat==='power'?10:1));}
    }
  });
  it('uses saved seeded randomness and reaches different cards across independent seeds',()=>{
    const targets=new Set<string>();
    for(let i=0;i<15;i++){const a=fresh(`draw-${i}`),b=fresh(`draw-${i}`);createEnhancements(a);createEnhancements(b);expect(a).toEqual(b);a.enhancements.forEach(o=>targets.add(o.targetId));}
    expect(targets.size).toBeGreaterThan(10);
  });
  it('cannot redirect a displayed option to another card',()=>{
    const s=pending(),o=s.enhancements[0]!,other=o.targetIds?.[1]??s.owned.find(id=>id!==o.targetId)!;
    const rejected=act(s,{type:'chooseEnhancement',optionId:o.id,cardId:other});expect(rejected.ok).toBe(false);expect(rejected.state).toBe(s);
    const before=s.cards[o.targetId]!,after=commit(s,{type:'chooseEnhancement',optionId:o.id});
    expect(after.cards[o.targetId]![o.stat==='power'?'permanentPower':'permanentAmp']).toBe(before[o.stat==='power'?'permanentPower':'permanentAmp']+o.amount);
  });
  it('rerolls for 2 then 3 gold, keeps card growth unchanged and invalidates stale options',()=>{
    const s=pending(),old=s.enhancements.map(o=>o.targetId).sort(),first=commit(s,{type:'rerollEnhancement'},'reroll-1');
    expect(first.gold).toBe(s.gold-2);expect(first.enhancementRerolls).toBe(1);expect(first.cards).toEqual(s.cards);expect(first.enhancements.map(o=>o.targetId).sort()).not.toEqual(old);
    expect(act(first,{type:'rerollEnhancement'},'reroll-1').state).toBe(first);
    expect(act(first,{type:'chooseEnhancement',optionId:s.enhancements[0]!.id}).ok).toBe(false);
    const second=commit(first,{type:'rerollEnhancement'});expect(second.gold).toBe(first.gold-3);expect(second.enhancementRerolls).toBe(2);expect(parseRun(serializeRun(second))).toEqual(second);
  });
  it('preserves the exact state and RNG when funds or phase are invalid',()=>{
    const s=pending();s.log.push({id:`log-${s.nextId++}`,kind:'spend',text:'fixture spend',goldDelta:1-s.gold,battleIndex:s.battleIndex});s.gold=1;
    const raw=serializeRun(s),r=act(s,{type:'rerollEnhancement'});expect(r.ok).toBe(false);expect(r.state).toBe(s);expect(serializeRun(s)).toBe(raw);
    const battle=fresh();expect(act(battle,{type:'rerollEnhancement'}).state).toBe(battle);
  });
  it('keeps the same options and next reroll price after repeated save/load',()=>{
    const a=commit(pending(),{type:'rerollEnhancement'}),b=parseRun(serializeRun(a));expect(parseRun(serializeRun(b))).toEqual(a);
    expect(commit(a,{type:'rerollEnhancement'})).toEqual(commit(b,{type:'rerollEnhancement'}));
  });
  it('migrates actual v0.4.0 grouped rewards deterministically once without charging gold',()=>{
    const original=JSON.parse(oldJson) as RunState,a=parseRun(oldJson),b=parseRun(oldJson);
    expect(a).toEqual(b);expect(a.enhancements).toHaveLength(3);expect(a.enhancements.every(o=>o.targetIds===undefined)).toBe(true);expect(a.gold).toBe(original.gold);expect(a.cards).toEqual(original.cards);expect(a.battles).toEqual(original.battles);
    expect(parseRun(serializeRun(a))).toEqual(a);expect(commit(a,{type:'chooseEnhancement',optionId:a.enhancements[0]!.id}).phase).toBe('camp');
    const broken=JSON.parse(oldJson) as RunState;broken.enhancements[0]!.amount=999;expect(()=>parseRun(JSON.stringify(broken))).toThrow();
  });
  it('rejects duplicate targets and altered stats in a saved random reward',()=>{
    const s=pending(),dup=structuredClone(s);dup.enhancements[1]!.targetId=dup.enhancements[0]!.targetId;expect(()=>parseRun(JSON.stringify(dup))).toThrow();
    const altered=structuredClone(s);altered.enhancements[0]!.amount++;expect(()=>parseRun(JSON.stringify(altered))).toThrow();
  });
  it('shows all cards in a tiny deck without charging for a reroll with no alternatives',()=>{
    const s=fresh();s.removed=s.owned.slice(2);createEnhancements(s);expect(s.enhancements).toHaveLength(2);
    expect(act(s,{type:'rerollEnhancement'}).state).toBe(s);
  });
});
