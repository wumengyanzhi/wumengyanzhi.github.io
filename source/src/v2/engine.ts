import { CARD_MAP, CARDS, CHARM_MAP, CHARMS, DECKS } from './data';
import { discardCards, enhanceCard, getBattleChoices, getEquipment, resolvePlay, startBattle } from './battle';
import { cloneRun, RuleError } from './model';
import type { ActionResult, CardInstance, GameAction, RunState } from './model';
import { random, sample, seedHash } from './rng';
import { act as legacyAct, createRun as createLegacyRun } from './legacy/engine';
import { CAMPAIGN_CONTENT_VERSION, LEGACY_CONTENT_VERSION, chapterIndex, charmTier, enemiesFor, forgeTerms, isRouteCharm, resaleValue, upgradeTerms } from './campaign';
import { activeCards, createCharmReward, createEnhancements, enhancementRerollCost, legalStat, nextId, rollEnhancements } from './campaign-rewards';

export { createLegacyRun };
export const CONTENT_VERSION = CAMPAIGN_CONTENT_VERSION;
const requireRule = (condition: unknown, message: string): void => { if (!condition) throw new RuleError(message); };
const id = nextId;
function log(state: RunState, text: string, goldDelta = 0, kind = 'event'): void {
  state.gold += goldDelta;
  state.log.push({id:id(state,'log'),kind,text,goldDelta,battleIndex:state.battleIndex});
}
function pay(state: RunState, amount: number, text: string): void {
  requireRule(state.gold >= amount, '金币不足'); log(state,text,-amount,'spend');
}
function addCard(state: RunState, definitionId: string): CardInstance {
  requireRule(CARD_MAP[definitionId], '卡牌不存在');
  const card: CardInstance = { id:id(state,'card'),definitionId,permanentPower:0,permanentAmp:0,temporaryPower:0,temporaryAmp:0,used:[],plays:0,chain:false,enhancementSkills:[],growthRemainder:0 };
  state.cards[card.id]=card; state.owned.push(card.id); return card;
}
export function validLeaders(state: RunState): string[] {
  const characters = activeCards(state).filter(cardId=>CARD_MAP[state.cards[cardId]!.definitionId]!.type==='character');
  const preferred=characters.filter(cardId=>['epic','legendary'].includes(CARD_MAP[state.cards[cardId]!.definitionId]!.rarity));
  return preferred.length ? preferred : characters;
}
export function createRun(deckId: string, leaderDefinitionId: string, seed: string, difficulty: 'standard'|'elite'='standard'): RunState {
  const deck=DECKS.find(item=>item.id===deckId);
  requireRule(deck,'起始牌组不存在'); requireRule(deck!.leaders.includes(leaderDefinitionId),'请选择起始牌组中的史诗先锋');
  requireRule(typeof seed==='string' && seed.length>0 && seed.length<=200,'种子应为1–200个字符');
  requireRule(difficulty==='standard'||difficulty==='elite','挑战类型无效');
  const state:RunState={version:2,ruleset:'mobile_v2',contentVersion:CONTENT_VERSION,seed,runId:'run:'+deckId+':'+seed,rng:{draw:seedHash(`${seed}:draw`),reward:seedHash(`${seed}:reward`),enhancement:seedHash(`${seed}:enhancement`),market:seedHash(`${seed}:market`)},revision:0,receipts:[],deckId,difficulty,leaderId:null,phase:'battle',battleIndex:0,cards:{},owned:[],removed:[],charms:[null,null,null],gold:0,battle:null,reward:null,enhancements:[],enhancementRerolls:0,market:null,marketVisits:0,removalsBought:0,log:[],battles:[],nextId:1,currentReports:[],baseAmp:0,charmReward:null};
  for(const definitionId of deck!.cards) addCard(state,definitionId);
  state.leaderId=state.owned.find(cardId=>state.cards[cardId]!.definitionId===leaderDefinitionId)!;
  state.charms[0]={id:id(state,'charm'),definitionId:deck!.charm,acquiredPrice:0,tier:1};
  log(state,'初始军资',4,'income'); startBattle(state); return state;
}
function createReward(state: RunState): void {
  const first=state.battleIndex===0;
  let candidates:string[];
  if(first) candidates=sample(state,'reward',CARDS.filter(c=>c.type==='character'&&c.rarity==='legendary'),3).map(c=>c.id);
  else {
    const weights=[[0,75,25,0],[0,50,45,5],[0,30,60,10]][chapterIndex(state)]!;
    candidates=(['character','weapon','tactic'] as const).map(type=>{
      const groups=(['common','rare','epic','legendary'] as const).map((rarity,index)=>({cards:CARDS.filter(c=>c.type===type&&c.rarity===rarity),weight:weights[index]!})).filter(g=>g.cards.length&&g.weight>0);
      const total=groups.reduce((sum,g)=>sum+g.weight,0);let roll=random(state,'reward')*total;
      let group=groups.at(-1)!;for(const g of groups){roll-=g.weight;if(roll<0){group=g;break;}}
      return group.cards[Math.floor(random(state,'reward')*group.cards.length)]!.id;
    });
  }
  state.reward={id:id(state,'reward'),first,candidates};state.phase='cardReward';
}
function stockMarket(state: RunState): void {
  const owned=new Set(state.charms.flatMap(c=>c?[c.definitionId]:[]));
  state.market!.items=sample(state,'market',CHARMS.filter(c=>!c.starter&&!owned.has(c.id)),3).map(c=>({id:id(state,'item'),definitionId:c.id,sold:false}));
}
function afterEnhancement(state: RunState): void {
  state.enhancements=[];
  const local=state.battleIndex%6;
  if(local===1||local===3){state.phase='market';state.market={id:id(state,'market'),items:[],rerolls:0,forged:false,removed:false,upgraded:false};state.marketVisits++;stockMarket(state);}
  else if(local===2)createCharmReward(state,'milestone');
  else if(local===5)createCharmReward(state,'boss');
  else state.phase='camp';
}
function finishBattle(state: RunState): void {
  const b=state.battle!,won=b.hp<=0;
  state.battles.push({index:state.battleIndex,enemyId:b.enemyId,won,plays:b.completedPlays,discards:b.activeDiscards,reports:cloneRun(state).currentReports,remainingHp:b.hp});
  const playsLeft=b.playsLeft;state.battle=null;state.currentReports=[];
  for(const c of Object.values(state.cards)){c.temporaryPower=0;c.temporaryAmp=0;c.used=c.used.filter(m=>m.startsWith('run:'));c.plays=0;c.chain=false;}
  if(state.leaderId&&!activeCards(state).includes(state.leaderId))state.leaderId=null;
  if(!won){state.phase='lost';log(state,'本次进军结束');return;}
  if(state.battleIndex===enemiesFor(state).length-1){state.phase='won';log(state,'三关十八阵尽破');return;}
  log(state,'战胜敌阵',state.battleIndex%6===5?5:3,'income');
  if(playsLeft>0)log(state,'速胜军资',Math.min(2,playsLeft),'income');
  if([0,2,4].includes(state.battleIndex%6))createReward(state);else createEnhancements(state);
}
function needPhase(state: RunState, phase: RunState['phase']): void {requireRule(state.phase===phase,'当前阶段不能进行此操作');}
function slot(value:number,max:number):void {requireRule(Number.isInteger(value)&&value>=0&&value<max,'槽位无效');}
function clearChoices(state: RunState): void {state.battle!.equipment={};state.battle!.targets={};}
function pruneChoices(state: RunState): void {
  const choices=getBattleChoices(state);
  for(const [key,target] of Object.entries(state.battle!.targets)){const choice=choices.find(c=>c.key===key);if(!choice||!(choice.options.some(o=>o.id===target)||(choice.optional&&target==='')))delete state.battle!.targets[key];}
}
function placeCharm(state: RunState, definitionId:string, tier:1|2|3, requestedSlot:number|undefined, cost:number): void {
  let target=requestedSlot;
  const routeIndex=state.charms.findIndex(c=>c&&isRouteCharm(c.definitionId));
  if(target===undefined)target=isRouteCharm(definitionId)&&routeIndex>=0?routeIndex:state.charms.findIndex(c=>c===null);
  slot(target,3);
  requireRule(!state.charms.some((c,i)=>i!==target&&c?.definitionId===definitionId),'同名锦囊只能持有一枚');
  requireRule(!isRouteCharm(definitionId)||routeIndex<0||routeIndex===target,'路线乘幅最多装备一枚，请替换原路线');
  state.charms[target]={id:id(state,'charm'),definitionId,tier,acquiredPrice:cost};
}
function execute(state: RunState, action: GameAction): void {
  switch(action.type){
    case 'stage':{
      needPhase(state,'battle');slot(action.slot,5);const battle=state.battle!;const source=battle.slots.indexOf(action.cardId);
      requireRule(source>=0||battle.hand.includes(action.cardId),'该卡不在手牌或出牌框');
      const old=battle.slots[action.slot]!;
      if(source>=0)battle.slots[source]=old;
      else {battle.hand.splice(battle.hand.indexOf(action.cardId),1);if(old)battle.hand.push(old);}
      battle.slots[action.slot]=action.cardId;clearChoices(state);break;
    }
    case 'unstage':{
      needPhase(state,'battle');slot(action.slot,5);const cardId=state.battle!.slots[action.slot];requireRule(cardId,'该位置没有牌');
      const hand=state.battle!.hand;
      requireRule(hand.length<8,'手牌已满');
      requireRule(action.beforeId==null||hand.includes(action.beforeId),'手牌插入位置已失效');
      hand.splice(action.beforeId==null?hand.length:hand.indexOf(action.beforeId),0,cardId!);
      state.battle!.slots[action.slot]=null;clearChoices(state);break;
    }
    case 'reorderHand':{
      needPhase(state,'battle');const hand=state.battle!.hand;
      requireRule(hand.includes(action.cardId),'该卡不在手牌中');
      requireRule(action.beforeId===null||hand.includes(action.beforeId),'手牌插入位置已失效');
      if(action.beforeId!==action.cardId){hand.splice(hand.indexOf(action.cardId),1);hand.splice(action.beforeId===null?hand.length:hand.indexOf(action.beforeId),0,action.cardId);}
      break;
    }
    case 'recallAll':{
      needPhase(state,'battle');const battle=state.battle!;
      const cards=battle.slots.filter((id):id is string=>id!==null);
      requireRule(cards.length>0,'当前没有需要撤回的牌');requireRule(battle.hand.length+cards.length<=8,'手牌已满');
      battle.hand.push(...cards);battle.slots=Array<string|null>(5).fill(null);clearChoices(state);break;
    }
    case 'equip':{
      needPhase(state,'battle');const target=getEquipment(state)[action.weaponId];
      requireRule(target&&target===action.targetId,'兵器按相邻人物职业自动配属，不能手动覆盖');
      state.battle!.equipment={};pruneChoices(state);break;
    }
    case 'target':{
      needPhase(state,'battle');requireRule(action.key.startsWith('skill:'),'请选择技能目标');const choice=getBattleChoices(state).find(item=>item.key===action.key);
      requireRule(choice&&(choice.options.some(option=>option.id===action.targetId)||(choice.optional&&action.targetId==='')),'技能目标无效');state.battle!.targets[action.key]=action.targetId;break;
    }
    case 'play':needPhase(state,'battle');resolvePlay(state);if(state.battle!.hp<=0||state.phase==='lost')finishBattle(state);break;
    case 'discard':needPhase(state,'battle');discardCards(state,action.cardIds);pruneChoices(state);break;
    case 'chooseCard':{
      needPhase(state,'cardReward');const reward=state.reward!;
      requireRule(action.definitionId!==null||!reward.first,'首胜必须选择一位传说');
      if(action.definitionId!==null){
        requireRule(reward.candidates.includes(action.definitionId),'奖励候选无效');
        if(action.replaceId!==undefined){requireRule(activeCards(state).includes(action.replaceId),'替换目标不在有效牌组');state.removed.push(action.replaceId);if(state.leaderId===action.replaceId)state.leaderId=null;}
        const card=addCard(state,action.definitionId);log(state,`纳入 ${CARD_MAP[card.definitionId]!.name}`);
      }else {requireRule(action.replaceId===undefined,'跳过选卡时不能替换');log(state,'本次未纳入新卡');}
      state.reward=null;createEnhancements(state);break;
    }
    case 'chooseEnhancement':{
      needPhase(state,'enhanceReward');const option=state.enhancements.find(o=>o.id===action.optionId);requireRule(option,'强化候选已失效');
      requireRule(option!.targetIds===undefined,'强化规则已更新，请刷新页面后继续');
      const target=option!.targetId;
      requireRule((action.cardId===undefined||action.cardId===target)&&activeCards(state).includes(target)&&legalStat(state,target,option!.stat),'只能强化当前候选绑定的卡牌');
      enhanceCard(state,target,option!.stat,option!.amount,null);log(state,'领取随机战后强化');afterEnhancement(state);break;
    }
    case 'rerollEnhancement':{
      needPhase(state,'enhanceReward');requireRule(state.enhancements.every(o=>o.targetIds===undefined),'强化规则已更新，请刷新页面后继续');
      requireRule(activeCards(state).length>3,'已展示所有可强化卡牌，无需重抽');
      pay(state,enhancementRerollCost(state),'重抽强化候选');state.enhancements=rollEnhancements(state);state.enhancementRerolls++;break;
    }
    case 'chooseCharmReward':{
      needPhase(state,'charmReward');const reward=state.charmReward!;requireRule(reward,'锦囊奖励已失效');
      if(action.optionId!==null){
        const option=reward.candidates.find(o=>o.id===action.optionId);requireRule(option,'锦囊候选已失效');
        if(option!.kind==='upgrade'){
          const c=state.charms.find(c=>c?.id===option!.targetId);
          requireRule(c&&c.definitionId===option!.definitionId&&charmTier(c)+1===option!.tier,'升阶目标已变化');c!.tier=option!.tier;
        }else placeCharm(state,option!.definitionId,option!.tier,action.slot,0);
        log(state,'领取锦囊成长');
      }else log(state,'保留现有锦囊');
      state.baseAmp=(state.baseAmp??0)+reward.baseAmp;
      if(reward.baseAmp)log(state,`跨关基础增幅＋${reward.baseAmp}`);
      state.charmReward=null;state.phase='camp';break;
    }
    case 'buyCharm':{
      needPhase(state,'market');slot(action.slot,3);const item=state.market!.items.find(i=>i.id===action.itemId);requireRule(item&&!item.sold,'商品已失效');
      const def=CHARM_MAP[item!.definitionId]!;requireRule(!state.charms.some(c=>c?.definitionId===def.id),'同名锦囊只能持有一枚');
      const routeIndex=state.charms.findIndex(c=>c&&isRouteCharm(c.definitionId));requireRule(!isRouteCharm(def.id)||routeIndex<0||routeIndex===action.slot,'路线乘幅最多装备一枚，请替换原路线');
      const old=state.charms[action.slot],resale=old?resaleValue(old):0;requireRule(state.gold+resale>=def.price,'换购后金币不足');
      if(old)log(state,`出售 ${CHARM_MAP[old.definitionId]!.name}`,resale,'sale');pay(state,def.price,`购买 ${def.name}`);
      placeCharm(state,def.id,1,action.slot,def.price);item!.sold=true;break;
    }
    case 'upgradeCharm':{
      needPhase(state,'market');slot(action.slot,3);const terms=upgradeTerms(state,action.slot);requireRule(terms.allowed,'本店已升阶、阶数已满或尚未解锁');
      pay(state,terms.cost,'锦囊升阶');const c=state.charms[action.slot]!;c.tier=terms.nextTier as 2|3;c.acquiredPrice+=terms.cost;state.market!.upgraded=true;break;
    }
    case 'sellCharm':{
      needPhase(state,'market');slot(action.slot,3);const c=state.charms[action.slot];requireRule(c,'该槽位没有锦囊');
      log(state,`出售 ${CHARM_MAP[c!.definitionId]!.name}`,resaleValue(c!),'sale');state.charms[action.slot]=null;break;
    }
    case 'moveCharm':{
      requireRule(['battle','cardReward','enhanceReward','charmReward','market','camp'].includes(state.phase),'当前不能调整锦囊');slot(action.from,3);slot(action.to,3);
      [state.charms[action.from],state.charms[action.to]]=[state.charms[action.to]!,state.charms[action.from]!];break;
    }
    case 'rerollMarket':needPhase(state,'market');requireRule(state.market!.rerolls<2,'本店刷新已用尽');pay(state,2+state.market!.rerolls,'刷新军市');state.market!.rerolls++;stockMarket(state);break;
    case 'forge':{
      needPhase(state,'market');requireRule(!state.market!.forged,'本店锻造已使用');requireRule(activeCards(state).includes(action.cardId),'卡牌不在有效牌组');requireRule(legalStat(state,action.cardId,action.stat),'该卡不能强化此属性');
      const terms=forgeTerms(state);pay(state,terms.cost,'定向锻造');enhanceCard(state,action.cardId,action.stat,action.stat==='power'?terms.power:terms.amp,null);state.market!.forged=true;break;
    }
    case 'removeCard':{
      needPhase(state,'market');requireRule(!state.market!.removed,'本店删牌已使用');requireRule(activeCards(state).length>1,'必须保留至少一张牌');requireRule(activeCards(state).includes(action.cardId),'卡牌不在有效牌组');
      pay(state,2+state.removalsBought,'军市删牌');state.removed.push(action.cardId);if(state.leaderId===action.cardId)state.leaderId=null;state.removalsBought++;state.market!.removed=true;break;
    }
    case 'leaveMarket':needPhase(state,'market');state.market=null;state.phase='camp';break;
    case 'setLeader':needPhase(state,'camp');requireRule(validLeaders(state).includes(action.cardId),'先锋候选无效');state.leaderId=action.cardId;break;
    case 'nextBattle':{
      needPhase(state,'camp');const legal=validLeaders(state);requireRule(!legal.length||(state.leaderId!==null&&legal.includes(state.leaderId)),'请先重新指派先锋');
      if(!legal.length)state.leaderId=null;state.battleIndex++;requireRule(state.battleIndex<enemiesFor(state).length,'冒险已结束');state.phase='battle';startBattle(state);break;
    }
    default:throw new RuleError('未知操作');
  }
}
/** Commands clone before execution; rejection preserves resources, RNG and object identity. */
export function act(state: RunState, action: GameAction, commandId?: string): ActionResult {
  if(state.contentVersion===LEGACY_CONTENT_VERSION)return legacyAct(state,action,commandId);
  try{
    requireRule(state.version===2&&state.ruleset==='mobile_v2'&&state.contentVersion===CONTENT_VERSION,'规则版本不兼容');
    if(commandId!==undefined){requireRule(typeof commandId==='string'&&commandId.length>0&&commandId.length<=200,'命令编号无效');if(state.receipts.includes(commandId))return {ok:true,state,error:null};}
    const working=cloneRun(state);execute(working,action);working.revision++;
    if(commandId)working.receipts.push(commandId);
    return {ok:true,state:working,error:null};
  }catch(error){return {ok:false,state,error:error instanceof Error?error.message:'操作失败'};}
}
