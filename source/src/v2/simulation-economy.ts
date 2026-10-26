import { CARD_MAP, CHARM_MAP, DECKS, MATCH_MATRIX } from './data';
import { activeCards, enhancementForCard, enhancementRerollCost, legalStat } from './campaign-rewards';
import { charmTier, charmValues, forgeTerms, isRouteCharm, maxCharmTier, resaleValue, upgradeTerms } from './campaign';
import type { CardDef, GameAction, RunState } from './model';

export const ECONOMY_POLICY_VERSION = 'public-build-economy-v1';
export const ECONOMY_LIMITS = { enhancementRerolls: 2, marketRerolls: 1, enhancementTargetFraction: 0.8 } as const;
type Policy = 'matching' | 'growth';
interface Context { power: number; amp: number; ids: string[]; reports: RunState['currentReports']; }
const suffix = (id: string) => id.split('.').at(-1)!;
const average = (xs: number[], fallback: number) => xs.length ? xs.reduce((a,b) => a+b,0)/xs.length : fallback;
function context(s: RunState): Context {
  const reports = s.battles.slice(-3).flatMap(b => b.reports);
  return { ids: activeCards(s), reports, power: average(reports.map(p=>p.power),150), amp: Math.max(1,average(reports.map(p=>p.amp),14+(s.baseAmp??0))) };
}
function preferred(s: RunState): string {
  const starter = DECKS.find(d=>d.id===s.deckId)!.charm;
  return starter.endsWith('lian_ce_jian') ? 'zhou_liu_chou' : starter.endsWith('fu_ji_ling') ? 'zhe_jian_ling' : 'shuang_feng_jun_yin';
}
/** Uses only past public plays and the known owned deck, never draw order or RNG. */
function triggerChance(s: RunState, ctx: Context, id: string, policy: Policy): number {
  const name = suffix(id);
  if (['ju_shi_qi','wen_jun_gu'].includes(name)) return 1;
  if (name==='fu_ji_ling') return policy==='growth'||s.charms.some(c=>c?.definitionId.endsWith('zhe_jian_ling')) ? 1 : 0;
  const prior = name===preferred(s) ? 0.65 : name==='cheng_shi_jing' ? 0.55 : name==='cui_bing_fu' ? 0.6 : 0.25;
  const supports = ctx.reports.filter(report=>{
    const cards=report.playedIds.map(cardId=>CARD_MAP[s.cards[cardId]!.definitionId]!);
    const chars=cards.filter(d=>d.type==='character'), weapons=cards.filter(d=>d.type==='weapon'), tactics=cards.filter(d=>d.type==='tactic');
    switch(name){
      case 'cui_bing_fu':return report.sources.some(x=>x.kind==='equipment'&&x.amp>0);
      case 'lian_ce_jian':return tactics.length>=2;
      case 'shuang_feng_jun_yin':return chars.length>0&&weapons.length>=2;
      case 'zhou_liu_chou':return new Set(tactics.map(d=>d.id)).size>=2;
      case 'zhe_jian_ling':return chars.some(d=>d.profession==='archer');
      case 'cheng_shi_jing':return report.sources.some(x=>x.kind==='morale'&&x.amp>=5)&&new Set(cards.map(d=>d.type)).size>=2;
      default:return false;
    }
  }).length;
  return (supports+prior*2)/(ctx.reports.length+2);
}
function charmValue(s: RunState, ctx: Context, id: string, tier: number, policy: Policy): number {
  const v=charmValues(id,tier), chance=triggerChance(s,ctx,id,policy);
  return chance*(v.power*ctx.amp+v.amp*ctx.power+ctx.power*ctx.amp*(v.multiplier[0]/v.multiplier[1]-1));
}
function cardValue(s: RunState, d: CardDef, ctx: Context, permanentPower=0, permanentAmp=0): number {
  const ampPrice=ctx.power/ctx.amp;
  let score=d.power+permanentPower+(d.amp+permanentAmp)*ampPrice;
  const bonuses: Record<string,number>={zhao_yun:35,xia_hou_dun:25,zhu_ge_liang:25,pang_tong:12,guan_yu:25,lv_bu:-20,huang_zhong:25,sun_shang_xiang:20};
  score+=bonuses[d.skill]??(d.skill?10:0);
  if(d.skill==='cao_cao'||d.skill==='zhou_yu')score+=ctx.ids.filter(id=>CARD_MAP[s.cards[id]!.definitionId]!.faction===(d.skill==='cao_cao'?'wei':'wu')).length*4;
  if(d.type==='weapon'&&s.leaderId){
    const leader=CARD_MAP[s.cards[s.leaderId]!.definitionId]!;
    score+=(MATCH_MATRIX[leader.profession!]?.[d.weaponClass!]??0)*ampPrice;
  }
  if(d.type==='tactic'&&d.direction==='amp')score+=preferred(s)==='zhou_liu_chou'?15:5;
  return score;
}
function usage(s: RunState, ctx: Context, id: string): number {
  const c=s.cards[id]!, d=CARD_MAP[c.definitionId]!;
  const peers=ctx.ids.filter(other=>CARD_MAP[s.cards[other]!.definitionId]!.type===d.type);
  const best=Math.max(1,...peers.map(other=>{const card=s.cards[other]!;return cardValue(s,CARD_MAP[card.definitionId]!,ctx,card.permanentPower,card.permanentAmp);}));
  const quality=Math.max(0.1,Math.min(1,cardValue(s,d,ctx,c.permanentPower,c.permanentAmp)/best));
  const observed=ctx.reports.filter(p=>p.playedIds.includes(id)).length;
  return (0.15+quality*0.3+Number(s.leaderId===id)*0.25+observed)/(1+ctx.reports.length);
}
function enhancementValue(s: RunState, ctx: Context, id: string, stat: 'power'|'amp', amount: number): number {
  const c=s.cards[id]!, d=CARD_MAP[c.definitionId]!;
  let gain=amount*(stat==='amp'?ctx.power:ctx.amp);
  if(stat==='power'&&d.skill==='guan_yu')gain+=Math.floor((c.growthRemainder+amount)/20)*ctx.power;
  return gain*usage(s,ctx,id);
}
function charmSlots(s: RunState, id: string): number[] {
  if(s.charms.some(c=>c?.definitionId===id))return [];
  const route=s.charms.findIndex(c=>c&&isRouteCharm(c.definitionId));
  return isRouteCharm(id)&&route>=0?[route]:[0,1,2];
}
function chooseCard(s: RunState,ctx:Context): GameAction {
  const options=s.reward!.candidates.map(definitionId=>{
    const d=CARD_MAP[definitionId]!;
    const weakest=ctx.ids.filter(id=>id!==s.leaderId&&CARD_MAP[s.cards[id]!.definitionId]!.type===d.type)
      .sort((a,b)=>{const ca=s.cards[a]!,cb=s.cards[b]!;return cardValue(s,CARD_MAP[ca.definitionId]!,ctx,ca.permanentPower,ca.permanentAmp)-cardValue(s,CARD_MAP[cb.definitionId]!,ctx,cb.permanentPower,cb.permanentAmp);})[0];
    const old=weakest?s.cards[weakest]!:null;
    const oldValue=old?cardValue(s,CARD_MAP[old.definitionId]!,ctx,old.permanentPower,old.permanentAmp):0;
    return { definitionId,replaceId:weakest,gain:cardValue(s,d,ctx)-(s.reward!.first?0:oldValue) };
  }).sort((a,b)=>b.gain-a.gain);
  const best=options[0];
  if(!best||(!s.reward!.first&&best.gain<=1))return {type:'chooseCard',definitionId:null};
  return {type:'chooseCard',definitionId:best.definitionId,...(!s.reward!.first&&best.replaceId?{replaceId:best.replaceId}:{})};
}
function chooseEnhancement(s:RunState,ctx:Context):GameAction {
  const scored=s.enhancements.map(o=>({o,gain:enhancementValue(s,ctx,o.targetId,o.stat,o.amount)})).sort((a,b)=>b.gain-a.gain);
  const best=scored[0];if(!best)throw new Error('没有强化候选');
  const potential=Math.max(...ctx.ids.map(id=>{const o=enhancementForCard(s,id);return enhancementValue(s,ctx,id,o.stat,o.amount);}));
  const immediateShop=[1,3].includes(s.battleIndex%6);
  const upgradeReserve=s.charms.some(c=>c&&charmTier(c)<maxCharmTier(s))?(maxCharmTier(s)===2?4:6):0;
  const reserve=immediateShop?forgeTerms(s).cost+upgradeReserve:3;
  if(ctx.ids.length>3&&s.enhancementRerolls<ECONOMY_LIMITS.enhancementRerolls&&s.gold>=enhancementRerollCost(s)+reserve&&best.gain<potential*ECONOMY_LIMITS.enhancementTargetFraction)return {type:'rerollEnhancement'};
  return {type:'chooseEnhancement',optionId:best.o.id};
}
function chooseCharm(s:RunState,ctx:Context,policy:Policy):GameAction {
  const options=s.charmReward!.candidates.flatMap(o=>{
    if(o.kind==='upgrade'){
      const current=s.charms.find(c=>c?.id===o.targetId);
      return current?[{gain:charmValue(s,ctx,o.definitionId,o.tier,policy)-charmValue(s,ctx,o.definitionId,charmTier(current),policy),action:{type:'chooseCharmReward' as const,optionId:o.id}}]:[];
    }
    return charmSlots(s,o.definitionId).map(slot=>{
      const current=s.charms[slot];
      return {gain:charmValue(s,ctx,o.definitionId,o.tier,policy)-(current?charmValue(s,ctx,current.definitionId,charmTier(current),policy):0),action:{type:'chooseCharmReward' as const,optionId:o.id,slot}};
    });
  }).sort((a,b)=>b.gain-a.gain);
  return options[0]&&options[0].gain>0?options[0].action:{type:'chooseCharmReward',optionId:null};
}
function marketDecision(s:RunState,ctx:Context,policy:Policy):GameAction {
  const options:{action:GameAction;gain:number;cost:number}[]=[];
  s.charms.forEach((c,slot)=>{
    const t=upgradeTerms(s,slot);
    if(c&&t.allowed&&s.gold>=t.cost)options.push({action:{type:'upgradeCharm',slot},cost:t.cost,gain:charmValue(s,ctx,c.definitionId,t.nextTier,policy)-charmValue(s,ctx,c.definitionId,charmTier(c),policy)});
  });
  for(const item of s.market!.items.filter(i=>!i.sold))for(const slot of charmSlots(s,item.definitionId)){
    const old=s.charms[slot],cost=CHARM_MAP[item.definitionId]!.price-(old?resaleValue(old):0);
    if(s.gold<cost)continue;
    options.push({action:{type:'buyCharm',itemId:item.id,slot},cost:Math.max(1,cost),gain:charmValue(s,ctx,item.definitionId,1,policy)-(old?charmValue(s,ctx,old.definitionId,charmTier(old),policy):0)});
  }
  const forge=forgeTerms(s);
  if(!s.market!.forged&&s.gold>=forge.cost)for(const id of ctx.ids)for(const stat of ['power','amp'] as const){
    if(legalStat(s,id,stat))options.push({action:{type:'forge',cardId:id,stat},cost:forge.cost,gain:enhancementValue(s,ctx,id,stat,stat==='power'?forge.power:forge.amp)});
  }
  options.sort((a,b)=>b.gain/b.cost-a.gain/a.cost);
  if(options[0]&&options[0].gain>1)return options[0].action;
  if(!s.market!.removed&&ctx.ids.length>22&&s.gold>=4+s.removalsBought){
    const counts={character:0,weapon:0,tactic:0};for(const id of ctx.ids)counts[CARD_MAP[s.cards[id]!.definitionId]!.type]++;
    const weak=ctx.ids.filter(id=>{
      const c=s.cards[id]!,d=CARD_MAP[c.definitionId]!;
      return id!==s.leaderId&&d.rarity==='common'&&c.permanentPower===0&&c.permanentAmp===0&&counts[d.type]>(d.type==='character'?6:3);
    }).sort((a,b)=>usage(s,ctx,a)-usage(s,ctx,b))[0];
    if(weak)return {type:'removeCard',cardId:weak};
  }
  if(s.market!.rerolls<ECONOMY_LIMITS.marketRerolls&&s.gold>=8)return {type:'rerollMarket'};
  return {type:'leaveMarket'};
}
/** Pure decisions; every purchase/reward is applied later by the real engine. */
export function economyDecision(s:RunState,policy:Policy):GameAction|null {
  if(s.phase==='camp'){
    const sorted=[...s.charms].sort((a,b)=>{
      const order=(c:typeof a)=>c?(charmValues(c.definitionId,charmTier(c)).multiplier[0]>1?1:0):2;
      return order(a)-order(b)||(a?.id??'').localeCompare(b?.id??'');
    });
    const to=s.charms.findIndex((c,i)=>c?.id!==sorted[i]?.id);
    if(to>=0){const from=s.charms.findIndex(c=>c?.id===sorted[to]?.id);return {type:'moveCharm',from,to};}
    return null;
  }
  if(!['cardReward','enhanceReward','charmReward','market'].includes(s.phase))return null;
  const ctx=context(s);
  if(s.phase==='cardReward')return chooseCard(s,ctx);
  if(s.phase==='enhanceReward')return chooseEnhancement(s,ctx);
  if(s.phase==='charmReward')return chooseCharm(s,ctx,policy);
  return marketDecision(s,ctx,policy);
}
