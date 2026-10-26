import { CARD_MAP, CARDS, CHARM_MAP, CHARMS, DECKS, ENEMIES } from './data';
import { canEcho, discardCards, enhanceCard, getBattleChoices, getEquipment, resolvePlay, startBattle } from './battle';
import { cloneRun, RuleError } from '../model';
import type { ActionResult, CardDef, CardInstance, EnhanceOption, EnhancementSkill, GameAction, RunState } from '../model';
import { random, sample, seedHash } from '../rng';

export const CONTENT_VERSION = 'mobile-v2-2026-10-17';
const SKILLS: EnhancementSkill[] = ['xian_deng','zhen_jun','tong_dao','gu_feng','jun_xu','hui_xiang'];
const VICTORY_GOLD = [3,3,4,3,4,0];
const requireRule = (condition: unknown, message: string): void => { if (!condition) throw new RuleError(message); };
const id = (state: RunState, prefix: string) => `${prefix}-${state.nextId++}`;
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
const active = (state: RunState): string[] => state.owned.filter(cardId=>!state.removed.includes(cardId));
export function validLeaders(state: RunState): string[] {
  const characters = active(state).filter(cardId=>CARD_MAP[state.cards[cardId]!.definitionId]!.type==='character');
  const preferred=characters.filter(cardId=>['epic','legendary'].includes(CARD_MAP[state.cards[cardId]!.definitionId]!.rarity));
  return preferred.length ? preferred : characters;
}
export function createRun(deckId: string, leaderDefinitionId: string, seed: string, difficulty: 'standard'|'elite'='standard'): RunState {
  const deck=DECKS.find(item=>item.id===deckId);
  requireRule(deck,'起始牌组不存在'); requireRule(deck!.leaders.includes(leaderDefinitionId),'请选择起始牌组中的史诗先锋');
  requireRule(typeof seed==='string' && seed.length>0 && seed.length<=200,'种子应为 1–200 个字符');
  requireRule(difficulty==='standard'||difficulty==='elite','挑战类型无效');
  const state:RunState={version:2,ruleset:'mobile_v2',contentVersion:CONTENT_VERSION,seed,runId: 'run:' + deckId + ':' + seed,rng:{draw:seedHash(`${seed}:draw`),reward:seedHash(`${seed}:reward`),enhancement:seedHash(`${seed}:enhancement`),market:seedHash(`${seed}:market`)},revision:0,receipts:[],deckId,difficulty,leaderId:null,phase:'battle',battleIndex:0,cards:{},owned:[],removed:[],charms:[null,null,null],gold:0,battle:null,reward:null,enhancements:[],enhancementRerolls:0,market:null,marketVisits:0,removalsBought:0,log:[],battles:[],nextId:1,currentReports:[]};
  for(const definitionId of deck!.cards) addCard(state,definitionId);
  state.leaderId=state.owned.find(cardId=>state.cards[cardId]!.definitionId===leaderDefinitionId)!;
  const charm=CHARM_MAP[deck!.charm]!;
  state.charms[0]={id:id(state,'charm'),definitionId:charm.id,acquiredPrice:charm.price};
  log(state,'初始军资',4,'income'); startBattle(state); return state;
}
function weighted<T>(state:RunState,stream:'reward'|'enhancement',values:readonly {value:T;weight:number}[]):T {
  const total=values.reduce((sum,item)=>sum+item.weight,0); requireRule(total>0,'没有合法随机候选');
  let roll=random(state,stream)*total;
  for(const item of values){roll-=item.weight;if(roll<0)return item.value;}
  return values[values.length-1]!.value;
}
function createReward(state:RunState):void {
  const first=state.battleIndex===0;
  let candidates:string[];
  if(first) candidates=sample(state,'reward',CARDS.filter(card=>card.type==='character'&&card.rarity==='legendary'),3).map(card=>card.id);
  else {
    const weights=state.battleIndex===1?[0,75,25,0]:state.battleIndex<=3?[0,55,40,5]:[0,35,55,10];
    candidates=(['character','weapon','tactic'] as const).flatMap(type=>{
      const groups=(['common','rare','epic','legendary'] as const).map((rarity,index)=>({value:CARDS.filter(card=>card.type===type&&card.rarity===rarity),weight:weights[index]!})).filter(group=>group.weight>0&&group.value.length>0);
      if(!groups.length)return [];
      const pool=weighted(state,'reward',groups);
      return [pool[Math.floor(random(state,'reward')*pool.length)]!.id];
    });
  }
  state.reward={id:id(state,'reward'),first,candidates};state.phase='cardReward';
}
function legalStat(card:CardDef, stat:'power'|'amp'):boolean {return (stat==='power'||stat==='amp')&&(card.type==='weapon'||(card.type==='character'?stat==='power':card.direction===stat));}
function createEnhancements(state:RunState):void {
  const chances=state.battleIndex<2?[50,45,5]:state.battleIndex<4?[40,50,10]:[25,60,15];
  state.enhancements=sample(state,'enhancement',active(state),3).map(targetId=>{
    const instance=state.cards[targetId]!;const def=CARD_MAP[instance.definitionId]!;
    const tier=weighted(state,'enhancement',(['common','rare','legendary'] as const).map((value,index)=>({value,weight:chances[index]!})));
    const stat=def.type==='weapon'?(random(state,'enhancement')<.5?'power':'amp'):def.type==='character'?'power':def.direction!;
    let amount=tier==='common'?(stat==='power'?20:2):(stat==='power'?30:3);
    let skill:EnhancementSkill|null=null;
    if(tier==='legendary'){
      const legal=SKILLS.filter(value=>!instance.enhancementSkills.includes(value)&&(value!=='hui_xiang'||canEcho(def)));
      if(legal.length) skill=legal[Math.floor(random(state,'enhancement')*legal.length)]!;
      else amount+=stat==='power'?10:1;
    }
    return {id:id(state,'enhance'),targetId,tier,stat,amount,skill} satisfies EnhanceOption;
  });
  state.phase='enhanceReward';
  if(!state.enhancements.length){ log(state,'无合法强化目标');afterEnhancement(state); }
}
function stockMarket(state:RunState):void {
  const owned=new Set(state.charms.flatMap(charm=>charm?[charm.definitionId]:[]));
  state.market!.items=sample(state,'market',CHARMS.filter(charm=>!charm.starter&&!owned.has(charm.id)),3).map(charm=>({id:id(state,'item'),definitionId:charm.id,sold:false}));
}
function afterEnhancement(state:RunState):void {
  state.enhancements=[];
  if(state.battleIndex===1||state.battleIndex===3){state.phase='market';state.market={id:id(state,'market'),items:[],rerolls:0,forged:false,removed:false};state.marketVisits++;stockMarket(state);}
  else state.phase='camp';
}
function finishBattle(state:RunState):void {
  const battle=state.battle!;const won=battle.hp<=0;
  state.battles.push({index:state.battleIndex,enemyId:battle.enemyId,won,plays:battle.completedPlays,discards:battle.activeDiscards,reports:cloneRun(state).currentReports,remainingHp:battle.hp});
  const playsLeft=battle.playsLeft;
  state.battle=null;state.currentReports=[];
  for(const card of Object.values(state.cards)){card.temporaryPower=0;card.temporaryAmp=0;card.used=card.used.filter(marker=>marker.startsWith('run:'));card.plays=0;card.chain=false;}
  if(state.leaderId&&!active(state).includes(state.leaderId))state.leaderId=null;
  if(!won){state.phase='lost';log(state,'本次进军结束');return;}
  if(state.battleIndex===ENEMIES.length-1){state.phase='won';log(state,'六阵尽破');return;}
  log(state,'战胜敌阵',VICTORY_GOLD[state.battleIndex]!,'income');
  if(playsLeft>0)log(state,'速胜军资',Math.min(2,playsLeft),'income');
  createReward(state);
}
function needPhase(state:RunState,phase:RunState['phase']):void {requireRule(state.phase===phase,'当前阶段不能进行此操作');}
function slot(value:number,max:number):void {requireRule(Number.isInteger(value)&&value>=0&&value<max,'槽位无效');}
function clearChoices(state:RunState):void {state.battle!.equipment={};state.battle!.targets={};}
function pruneChoices(state:RunState):void {
  const choices=getBattleChoices(state);
  for(const [key,target] of Object.entries(state.battle!.targets)){const choice=choices.find(value=>value.key===key);if(!choice||!(choice.options.some(option=>option.id===target)||(choice.optional&&target==='')))delete state.battle!.targets[key];}
}
function execute(state:RunState,action:GameAction):void {
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
      needPhase(state,'cardReward');const reward=state.reward!;requireRule(action.definitionId!==null||!reward.first,'首胜必须选择一位传说');
      if(action.definitionId!==null){requireRule(reward.candidates.includes(action.definitionId),'奖励候选无效');const card=addCard(state,action.definitionId);log(state,`纳入 ${CARD_MAP[card.definitionId]!.name}`);}
      else log(state,'本次未纳入新卡');state.reward=null;state.enhancementRerolls=0;createEnhancements(state);break;
    }
    case 'chooseEnhancement':{
      needPhase(state,'enhanceReward');const option=state.enhancements.find(item=>item.id===action.optionId);requireRule(option,'强化候选已失效');
      enhanceCard(state,option!.targetId,option!.stat,option!.amount,option!.skill);log(state,'完成战后强化');afterEnhancement(state);break;
    }
    case 'rerollEnhancement':needPhase(state,'enhanceReward');requireRule(state.enhancementRerolls<1,'本次强化已经刷新');pay(state,2,'刷新强化');state.enhancementRerolls++;createEnhancements(state);break;
    case 'buyCharm':{
      needPhase(state,'market');slot(action.slot,3);const item=state.market!.items.find(value=>value.id===action.itemId);requireRule(item&&!item.sold,'商品已失效');const def=CHARM_MAP[item!.definitionId]!;
      requireRule(!state.charms.some(charm=>charm?.definitionId===def.id),'同名锦囊只能持有一枚');
      const old=state.charms[action.slot];const resale=old?Math.max(1,Math.floor(old.acquiredPrice/2)):0;
      requireRule(state.gold+resale>=def.price,'换购后金币不足');
      if(old)log(state,`出售 ${CHARM_MAP[old.definitionId]!.name}`,resale,'sale');pay(state,def.price,`购买 ${def.name}`);
      state.charms[action.slot]={id:id(state,'charm'),definitionId:def.id,acquiredPrice:def.price};item!.sold=true;break;
    }
    case 'sellCharm':{
      needPhase(state,'market');slot(action.slot,3);const charm=state.charms[action.slot];requireRule(charm,'该槽位没有锦囊');
      log(state,`出售 ${CHARM_MAP[charm!.definitionId]!.name}`,Math.max(1,Math.floor(charm!.acquiredPrice/2)),'sale');state.charms[action.slot]=null;break;
    }
    case 'moveCharm':{
      requireRule(['battle','cardReward','enhanceReward','market','camp'].includes(state.phase),'当前不能调整锦囊');slot(action.from,3);slot(action.to,3);
      [state.charms[action.from],state.charms[action.to]]=[state.charms[action.to]!,state.charms[action.from]!];break;
    }
    case 'rerollMarket':needPhase(state,'market');requireRule(state.market!.rerolls<2,'本店刷新已用尽');pay(state,2+state.market!.rerolls,'刷新军市');state.market!.rerolls++;stockMarket(state);break;
    case 'forge':{
      needPhase(state,'market');requireRule(!state.market!.forged,'本店锻造已使用');requireRule(active(state).includes(action.cardId),'卡牌不在有效牌组');requireRule(legalStat(CARD_MAP[state.cards[action.cardId]!.definitionId]!,action.stat),'该卡不能强化此属性');
      pay(state,3,'定向锻造');enhanceCard(state,action.cardId,action.stat,action.stat==='power'?20:2,null);state.market!.forged=true;break;
    }
    case 'removeCard':{
      needPhase(state,'market');requireRule(!state.market!.removed,'本店删牌已使用');requireRule(active(state).length>1,'必须保留至少一张牌');requireRule(active(state).includes(action.cardId),'卡牌不在有效牌组');
      pay(state,2+state.removalsBought,'军市删牌');state.removed.push(action.cardId);if(state.leaderId===action.cardId)state.leaderId=null;state.removalsBought++;state.market!.removed=true;break;
    }
    case 'leaveMarket':needPhase(state,'market');state.market=null;state.phase='camp';break;
    case 'setLeader':needPhase(state,'camp');requireRule(validLeaders(state).includes(action.cardId),'先锋候选无效');state.leaderId=action.cardId;break;
    case 'nextBattle':{
      needPhase(state,'camp');const legal=validLeaders(state);requireRule(!legal.length||(state.leaderId!==null&&legal.includes(state.leaderId)),'请先重新指派先锋');
      if(!legal.length)state.leaderId=null;state.battleIndex++;requireRule(state.battleIndex<ENEMIES.length,'冒险已结束');state.phase='battle';startBattle(state);break;
    }
    default:throw new RuleError('未知操作');
  }
}
/** Every command commits as a whole; failures preserve the exact original object and RNG. */
export function act(state:RunState,action:GameAction,commandId?:string):ActionResult {
  try {
    requireRule(state.version===2&&state.ruleset==='mobile_v2','规则版本不兼容');
    if(commandId!==undefined){requireRule(typeof commandId==='string'&&commandId.length>0&&commandId.length<=200,'命令编号无效');if(state.receipts.includes(commandId))return {ok:true,state,error:null};}
    const working=cloneRun(state);execute(working,action);working.revision++;
    if(commandId)working.receipts.push(commandId);
    return {ok:true,state:working,error:null};
  }catch(error){return {ok:false,state,error:error instanceof Error?error.message:'操作失败'};}
}
