import { describe, expect, it } from 'vitest';
import { CARDS, CARD_MAP, DECKS, ENEMIES } from '../../v2/data';
import { act, createRun } from '../../v2/engine';
import { previewBattle, startBattle } from '../../v2/battle';
import type { GameAction, RunState } from '../../v2/model';

const newRun = () => createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'campaign-spec');
const charm = (name: string, tier: 1|2|3 = 1) => ({id:`ch-${name}`,definitionId:`three_kingdoms.charm.${name}`,tier,acquiredPrice:0});
function formation(names: (string|null)[], index = 0): RunState {
  const s = newRun(); s.cards={};s.owned=[];s.leaderId=null;s.battleIndex=index;s.charms=[null,null,null];
  names.forEach((name,i)=>{if(!name)return;const id=`c${i}`;s.owned.push(id);s.cards[id]={id,definitionId:CARDS.find(c=>c.name===name)!.id,permanentPower:0,permanentAmp:0,temporaryPower:0,temporaryAmp:0,plays:0,chain:false,used:[],enhancementSkills:[],growthRemainder:0};});
  startBattle(s);s.battle!.slots=names.map((n,i)=>n?`c${i}`:null);s.battle!.hand=[];s.battle!.draw=[];return s;
}
function commit(s: RunState, a: GameAction): RunState {
  const r = act(s, a); expect(r.error).toBeFalsy(); expect(r.ok).toBe(true); return r.state;
}
describe('eighteen-battle campaign', () => {
  it('has the prescribed eighteen HP values and only three bosses', () => {
    expect(ENEMIES.map(e => e.hp)).toEqual([2400,4400,6400,8400,10400,12400,18600,21600,24600,27600,30600,33600,50400,54900,59400,63900,68400,72900]);
    expect(ENEMIES.filter(e => e.kind === 'boss')).toHaveLength(3);
    expect(ENEMIES.filter(e => e.kind !== 'boss').every(e => e.rule === 'none')).toBe(true);
  });
  it('starts the new version with a free tier-I charm and no boss amp', () => {
    const s = newRun();
    expect(s.contentVersion).toBe('mobile-v2-campaign-2026-10-20');
    expect(s.baseAmp).toBe(0);
    expect(s.charms[0]).toMatchObject({ tier: 1, acquiredPrice: 0 });
    expect(s.battle?.hp).toBe(2400);
  });
  it('offers three fixed random enhancements after the first card reward', () => {
    let s = newRun();
    s.battle!.hp = 1;
    const character = s.battle!.hand.find(id => CARD_MAP[s.cards[id]!.definitionId]!.type === 'character')!;
    s = commit(s, { type: 'stage', cardId: character, slot: 2 });
    s = commit(s, { type: 'play' });
    s = commit(s, { type: 'chooseCard', definitionId: s.reward!.candidates[0]! });
    expect(s.enhancements).toHaveLength(3);
    expect(s.enhancements.every(o=>o.targetIds===undefined)).toBe(true);
    const option=s.enhancements[0]!,field=option.stat==='power'?'permanentPower':'permanentAmp';
    const before=s.cards[option.targetId]![field];
    s=commit(s,{type:'chooseEnhancement',optionId:option.id});
    expect(s.cards[option.targetId]![field]).toBe(before+option.amount);
    expect(s.phase).toBe('camp');
  });
});

describe('campaign multiplier and boss scoring',()=>{
  it('activates the starter only with a primary equipment match and replaces values by tier',()=>{
    const s=formation(['蜀中猛士','环首刀',null,null,null]);
    const base=previewBattle(s).report!;
    for(const [tier,amp] of [[1,2],[2,6],[3,10]] as const){s.charms[0]=charm('cui_bing_fu',tier);expect(previewBattle(s).report?.amp).toBe(base.amp+amp);}
    s.battle!.slots=['c0',null,'c1',null,null];
    const missed=previewBattle(s).report!;s.charms[0]=null;expect(missed.amp).toBe(previewBattle(s).report?.amp);
  });
  it('preserves fractions across ordered charms and floors only before final multiplication',()=>{
    const s=formation(['蜀中猛士','擂鼓进军','筹措军粮',null,null]);
    s.battle!.moraleTier='formed';s.battle!.morale=5;
    s.baseAmp=13-previewBattle(s).report!.amp;
    s.charms=[charm('zhou_liu_chou'),charm('cheng_shi_jing',2),charm('ju_shi_qi')];
    const before=JSON.stringify(s),p=previewBattle(s).report!;
    expect(p.amp).toBe(25);expect(p.damage).toBe(p.power*25);expect(JSON.stringify(s)).toBe(before);
    expect(p.sources.filter(x=>x.kind==='charm')).toHaveLength(3);
  });
  it('boss two allows a double wield formation with an empty second slot',()=>{
    const s=formation([null,null,'环首刀','蜀中猛士','长柄铁枪'],11);
    s.charms[0]=charm('shuang_feng_jun_yin');
    const safe=previewBattle(s).report!;expect(safe.sources.find(x=>x.kind==='charm')?.multiplier).toBe(1.3);
    s.battle!.slots[1]='c2';s.battle!.slots[2]=null;
    const occupied=previewBattle(s).report!;
    expect(occupied.sources.find(x=>x.kind==='enemy')?.power).toBeLessThan(0);
    expect(safe.sources.filter(x=>x.kind==='enemy')).toHaveLength(0);
  });
  it('boss three scales amp by 0.75 when either endpoint is not a character',()=>{
    const s=formation(['蜀中猛士',null,null,null,'魏营宿卫'],17);s.baseAmp=10;
    const safe=previewBattle(s).report!;expect(safe.amp).toBe(11);
    s.battle!.slots=[null,'c0',null,null,'c4'];
    expect(previewBattle(s).report!.amp).toBe(Math.max(1,Math.floor(safe.amp*0.75)));
  });
});
