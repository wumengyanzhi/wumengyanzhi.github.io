import { CARD_MAP, CHARM_MAP, DECKS, ENEMIES } from './data';
import { CONTENT_VERSION } from './engine';
import { canEcho, getBattleChoices } from './battle';
import type { BattleReport, RunState } from './model';
import * as legacy from './legacy/persistence';
import { LEGACY_CONTENT_VERSION, isRouteCharm, maxCharmTier } from './campaign';
import { createEnhancements, eligibleCharmChoices, enhancementForCard, enhancementGroups } from './campaign-rewards';

/** Independent namespace: importing V2 never reads or rewrites a legacy save. */
export const SAVE_KEY = 'three_kingdoms.run.mobile_v2.save';
const MAX_BYTES=2_000_000;
function check(condition:unknown,message:string):asserts condition { if(!condition)throw new Error(`存档无效：${message}`); }
function record(value:unknown):asserts value is Record<string,unknown>{check(typeof value==='object'&&value!==null&&!Array.isArray(value),'对象格式错误');}
function text(value:unknown,max=200):asserts value is string{check(typeof value==='string'&&value.length<=max,'文本格式或长度错误');}
function integer(value:unknown,min=0,max=1_000_000_000_000):asserts value is number{check(typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max,'数值越界');}
function finite(value:unknown,min=-1_000_000_000,max=1_000_000_000):void{check(typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max,'小数数值越界');}
function array(value:unknown,max=1000):asserts value is unknown[]{check(Array.isArray(value)&&value.length<=max,'列表格式或长度错误');}
function strings(value:unknown,max=1000,unique=false):asserts value is string[]{array(value,max);for(const item of value)text(item);if(unique)check(new Set(value).size===value.length,'重复标识');}
function bool(value:unknown):void{check(typeof value==='boolean','布尔值错误');}
function report(value:unknown):asserts value is BattleReport{
  record(value);for(const key of ['power','amp','damage','actualDamage','overflow'])integer(value[key]);
  check(value.damage===Number(value.power)*Number(value.amp),'伤害与威力增幅不一致');
  check(Number(value.actualDamage)+Number(value.overflow)===value.damage,'伤害拆分不一致');
  strings(value.notes,100);strings(value.playedIds,5,true);array(value.sources,200);
  for(const source of value.sources){record(source);text(source.label,500);finite(source.power);finite(source.amp);check(['cards','equipment','morale','skill','enemy','charm'].includes(String(source.kind)),'来源类型错误');if(source.multiplier!==undefined)finite(source.multiplier,1,10);}
}
function validate(value:unknown):asserts value is RunState{
  record(value);check(value.version===2&&value.ruleset==='mobile_v2','不是 V2 存档');check(value.contentVersion===CONTENT_VERSION,'内容版本不兼容，请保留原导出');
  text(value.seed);check(value.seed.length>0,'种子为空');text(value.runId,500);check(value.runId.length>0,'远征标识为空');record(value.rng);for(const stream of ['draw','reward','enhancement','market'])integer(value.rng[stream],1,0xffffffff);
  integer(value.revision,0,100000);strings(value.receipts,100000,true);check(value.receipts.every(item=>item.length>0),'命令编号为空');
  check(DECKS.some(deck=>deck.id===value.deckId),'起始牌组不存在');check(['standard','elite'].includes(String(value.difficulty)),'挑战模式错误');
  const phases=['battle','cardReward','enhanceReward','charmReward','market','camp','won','lost'];check(phases.includes(String(value.phase)),'阶段错误');integer(value.battleIndex,0,17);
  record(value.cards);const ids=Object.keys(value.cards);check(ids.length>=1&&ids.length<=1000,'卡牌实体数量错误');
  strings(value.owned,1000,true);strings(value.removed,1000,true);check(value.owned.length>=1,'有效牌组为空');
  const all=new Set(value.owned);check(all.size===ids.length&&ids.every(id=>all.has(id))&&value.removed.every(id=>all.has(id))&&value.owned.some(id=>!(value.removed as string[]).includes(id)),'所有权与移除记录不一致');
  const skills=['xian_deng','zhen_jun','tong_dao','gu_feng','jun_xu','hui_xiang'];
  for(const [id,card] of Object.entries(value.cards)){
    text(id);record(card);check(card.id===id,'卡牌实体标识不一致');text(card.definitionId);check(Object.hasOwn(CARD_MAP,card.definitionId),'未知卡牌定义');
    for(const key of ['permanentPower','permanentAmp','temporaryPower','temporaryAmp'])integer(card[key]);
    integer(card.plays,0,4);integer(card.growthRemainder,0,19);strings(card.used,100,true);bool(card.chain);strings(card.enhancementSkills,6,true);check(card.enhancementSkills.every(skill=>skills.includes(skill)),'未知附加技能');
    check(!card.enhancementSkills.includes('hui_xiang')||canEcho(CARD_MAP[card.definitionId]!), '该卡不能获得回响');
    check(!card.chain||(CARD_MAP[card.definitionId]!.type==='tactic'&&Number(card.plays)>0),'不可能的连环状态');
    check(card.used.length<=3&&card.used.every(marker=>/^run:zhen_jun:(?:[0-9]|1[0-7])$/.test(marker)&&Number(marker.split(':').at(-1))<=Number(value.battleIndex)),'本局限次记录错误');
    if(value.phase!=='battle')check(card.temporaryPower===0&&card.temporaryAmp===0&&card.plays===0&&card.chain===false&&card.used.every(marker=>marker.startsWith('run:')),'战外仍有本场状态');
  }
  check(value.leaderId===null||(typeof value.leaderId==='string'&&value.owned.includes(value.leaderId)&&!value.removed.includes(value.leaderId)&&CARD_MAP[(value.cards[value.leaderId] as Record<string,string>).definitionId!]!.type==='character'),'先锋引用错误');
  array(value.charms,3);check(value.charms.length===3,'锦囊必须有三槽');const charmIds:string[]=[];const charmDefs:string[]=[];
  for(const charm of value.charms){if(charm===null)continue;record(charm);text(charm.id);text(charm.definitionId);check(Object.hasOwn(CHARM_MAP,charm.definitionId),'未知锦囊');integer(charm.acquiredPrice,0,100);integer(charm.tier,1,3);charmIds.push(charm.id);charmDefs.push(charm.definitionId);}
  check(charmDefs.filter(isRouteCharm).length<=1,'路线乘幅不能叠装');
  check(new Set(charmIds).size===charmIds.length&&new Set(charmDefs).size===charmDefs.length,'锦囊重复');integer(value.gold,0,1_000_000);
  const owned=new Set(value.owned.filter(id=>!(value.removed as string[]).includes(id)));const ref=(id:unknown):void=>{text(id);check(owned.has(id),'卡牌不在有效牌组');};
  const anyRef=(id:unknown):void=>{text(id);check(all.has(id),'卡牌引用不存在');};
  if(value.phase==='battle'){
    const battle=value.battle;record(battle);const enemy=ENEMIES[value.battleIndex]!;check(battle.enemyId===enemy.id,'敌阵与进度不一致');integer(battle.hp,1);integer(battle.maxHp,1);check(battle.maxHp===Math.ceil(enemy.hp*(value.difficulty==='elite'?1.15:1))&&Number(battle.hp)<=Number(battle.maxHp),'敌血与公开阵势不一致');
    integer(battle.playsLeft,1,4);integer(battle.discardsLeft,0,3);integer(battle.completedPlays,0,3);integer(battle.activeDiscards,0,3);check(Number(battle.playsLeft)+Number(battle.completedPlays)===4,'出战次数不守恒');check(Number(battle.discardsLeft)+Number(battle.activeDiscards)===3,'弃牌次数不守恒');
    const zones:unknown[]=[];for(const key of ['hand','draw','discard']){strings(battle[key],1000,true);zones.push(...battle[key]);}check((battle.hand as string[]).length<=8,'手牌超限');
    array(battle.slots,5);check(battle.slots.length===5,'出牌框不是五格');zones.push(...battle.slots.filter(id=>id!==null));zones.forEach(ref);check(new Set(zones).size===zones.length&&zones.length===owned.size,'牌区必须恰好包含所有有效实体');
    integer(battle.morale,0,10000);check(['none','formed','array'].includes(String(battle.moraleTier)),'军势档位错误');if(battle.moraleTier==='none')check(battle.morale===0,'未成军却有军势');
    strings(battle.discardedTypes,3,true);check(battle.discardedTypes.every(type=>['character','weapon','tactic'].includes(type)),'弃牌类型错误');strings(battle.used,1000,true);
    record(battle.equipment);for(const [weapon,target] of Object.entries(battle.equipment)){ref(weapon);ref(target);check(battle.slots.includes(weapon)&&battle.slots.includes(target),'装备引用不在出牌框');check(CARD_MAP[(value.cards[weapon] as Record<string,string>).definitionId!]!.type==='weapon','装备源不是武器');check(CARD_MAP[(value.cards[target as string] as Record<string,string>).definitionId!]!.type==='character','装备目标不是人物');check(Math.abs(battle.slots.indexOf(weapon)-battle.slots.indexOf(target))===1,'装备目标不相邻');}
    record(battle.targets);check(Object.keys(battle.targets).length<=20,'技能目标过多');for(const [key,target] of Object.entries(battle.targets)){text(key);if(target!=='')ref(target);}
    array(battle.swallow,5);for(const mark of battle.swallow){record(mark);anyRef(mark.sourceId);anyRef(mark.targetId);integer(mark.power);}
  }else check(value.battle===null,'战外含未结束战斗');
  if(value.phase==='cardReward'){
    check([0,2,4].includes(value.battleIndex%6),'非选卡节点出现选卡');
    record(value.reward);text(value.reward.id);bool(value.reward.first);check(value.reward.first===(value.battleIndex===0),'首胜奖励标记错误');strings(value.reward.candidates,3,true);check(value.reward.candidates.length>0,'选卡候选为空');for(const candidate of value.reward.candidates)check(Object.hasOwn(CARD_MAP,candidate),'奖励定义不存在');
    if(value.reward.first)check(value.reward.candidates.length===3&&value.reward.candidates.every(id=>CARD_MAP[id]!.rarity==='legendary'&&CARD_MAP[id]!.type==='character'),'首胜候选错误');
    else {
      const candidates=value.reward.candidates.map(id=>CARD_MAP[id]!);
      check(candidates.length===3&&['character','weapon','tactic'].every(type=>candidates.some(card=>card.type===type)),'后续奖励必须人物、武器、战术各一张');
      const rarities=value.battleIndex<6?['rare','epic']:['rare','epic','legendary'];
      check(candidates.every(card=>rarities.includes(card.rarity)),'奖励稀有度与当前幕不一致');
    }
  }else check(value.reward===null,'奖励阶段不一致');
  array(value.enhancements,3);integer(value.enhancementRerolls,0,100000);check((value.phase==='enhanceReward')===(value.enhancements.length>0),'强化阶段不一致');
  const enhancementIds:string[]=[];
  if(value.phase==='enhanceReward'){
    const options=value.enhancements.map(option=>{record(option);return option;});
    if(options.some(o=>o.targetIds!==undefined)){
      const groups=enhancementGroups(value as unknown as RunState);
      check(value.enhancementRerolls===0&&value.enhancements.length===groups.length,'旧强化分组缺失');
      options.forEach((option,i)=>{text(option.id);enhancementIds.push(option.id);const saved={...option};delete saved.id;check(JSON.stringify(saved)===JSON.stringify(groups[i]),'旧强化候选不合法');});
    }else{
      check(value.enhancements.length===Math.min(3,owned.size),'随机强化候选数量错误');
      const targets=new Set<string>();
      for(const option of options){text(option.id);enhancementIds.push(option.id);ref(option.targetId);const expected=enhancementForCard(value as unknown as RunState,option.targetId as string);check(!targets.has(option.targetId as string),'强化目标重复');targets.add(option.targetId as string);check(option.stat===expected.stat&&option.amount===expected.amount&&option.tier===expected.tier&&option.skill===null,'随机强化属性不合法');}
    }
  }
  check(new Set(enhancementIds).size===enhancementIds.length,'强化候选重复');
  const charmRewardIds:string[]=[];
  if(value.phase==='charmReward'){
    const r=value.charmReward;record(r);text(r.id);charmRewardIds.push(r.id);
    const boss=Number(value.battleIndex)%6===5;check(boss||Number(value.battleIndex)%6===2,'非锦囊奖励节点');
    check(r.kind===(boss?'boss':'milestone'),'锦囊奖励类型错误');
    check(r.baseAmp===(boss?(value.battleIndex===5?4:6):0),'基础增幅奖励错误');
    const route=(value.charms as RunState['charms']).find(c=>c&&isRouteCharm(c.definitionId));check(r.routeAtVictory===(route?.id??null),'Boss路线快照错误');
    array(r.candidates,3);const legal=eligibleCharmChoices(value as unknown as RunState,boss?'boss':'milestone');check(r.candidates.length===legal.length,'锦囊候选数量错误');
    const normalized=(o:Record<string,unknown>)=>JSON.stringify([o.definitionId,o.tier,o.kind,o.targetId??null]);
    const remaining=new Set(legal.map(o=>normalized(o)));
    for(const o of r.candidates){record(o);text(o.id);charmRewardIds.push(o.id);check(remaining.delete(normalized(o)),'锦囊候选不合法或重复');}
  }else check(value.charmReward===null,'锦囊奖励阶段不一致');
  const expectedBase=(Number(value.battleIndex)>5?4:0)+(Number(value.battleIndex)>11?6:0)+(value.phase==='camp'&&value.battleIndex===5?4:0)+(value.phase==='camp'&&value.battleIndex===11?6:0);
  check(value.baseAmp===expectedBase,'跨关基础增幅与进度不一致');
  integer(value.marketVisits,0,6);integer(value.removalsBought,0,6);
  const expectedVisits=Array.from({length:Number(value.battleIndex)},(_,i)=>i).filter(i=>[1,3].includes(i%6)).length+([1,3].includes(Number(value.battleIndex)%6)&&['market','camp'].includes(String(value.phase))?1:0);
  check(value.marketVisits===expectedVisits&&Number(value.removalsBought)<=expectedVisits,'军市次数与进度不一致');
  if(value.phase==='market'){
    record(value.market);text(value.market.id);check([1,3].includes(Number(value.battleIndex)%6),'军市进度错误');integer(value.market.rerolls,0,2);bool(value.market.forged);bool(value.market.removed);bool(value.market.upgraded);array(value.market.items,3);check(value.market.items.length===3,'军市必须保留三个商品位');const itemIds:string[]=[];const itemDefs:string[]=[];
    for(const item of value.market.items){record(item);text(item.id);text(item.definitionId);check(Object.hasOwn(CHARM_MAP,item.definitionId)&&!CHARM_MAP[item.definitionId]!.starter,'军市商品错误');bool(item.sold);if(!item.sold)check(!charmDefs.includes(item.definitionId),'军市出现已持有锦囊');itemIds.push(item.id);itemDefs.push(item.definitionId);}
    check(new Set(itemIds).size===itemIds.length&&new Set(itemDefs).size===itemDefs.length,'军市商品重复');
  }else check(value.market===null,'军市阶段不一致');
  array(value.log,10000);let ledger=0;const logIds:string[]=[];for(const entry of value.log){record(entry);text(entry.id);text(entry.kind);text(entry.text,1000);integer(entry.goldDelta,-100000,100000);integer(entry.battleIndex,0,17);ledger+=entry.goldDelta;check(ledger>=0,'账本出现负余额');logIds.push(entry.id);}check(new Set(logIds).size===logIds.length,'账本标识重复');check(ledger===value.gold,'金币与账本不一致');
  array(value.currentReports,4);value.currentReports.forEach(report);for(const entry of value.currentReports)for(const cardId of (entry as BattleReport).playedIds)anyRef(cardId);check(value.phase==='battle'||value.currentReports.length===0,'战外包含当前伤害记录');
  if(value.phase==='battle'){
    const battle=value.battle as Record<string,unknown>;check(value.currentReports.length===battle.completedPlays,'出战记录与剩余次数不一致');
    for(const cardId of value.owned){const card=value.cards[cardId] as Record<string,unknown>;check(card.plays===value.currentReports.filter(entry=>(entry as BattleReport).playedIds.includes(cardId)).length,'实体出战次数不一致');}
    const choices=getBattleChoices(value as unknown as RunState);
    const slots=battle.slots as (string|null)[],oldEquipment=battle.equipment as Record<string,string>;
    const cards=value.cards as Record<string,Record<string,string>>;
    const definition=(id:string)=>CARD_MAP[cards[id]!.definitionId!]!;
    // Reconstruct the old ownership rules only to validate old explicit skill references.
    // Sanitation happens after the entire save passes validation, never before.
    const legacyEquipment:Record<string,string>={};
    slots.forEach((id,index)=>{
      if(!id||definition(id).type!=='weapon')return;
      const neighbors=[slots[index-1],slots[index+1]].filter((other):other is string=>!!other&&definition(other).type==='character');
      if(neighbors.length===1)legacyEquipment[id]=neighbors[0]!;
      else if(neighbors.length===2&&neighbors.includes(oldEquipment[id]!))legacyEquipment[id]=oldEquipment[id]!;
    });
    for(const [key,target] of Object.entries(battle.targets as Record<string,string>)){
      check(key.startsWith('skill:'),'技能键格式错误');const source=key.slice(6);ref(source);
      check(slots.includes(source)&&!(battle.used as string[]).includes(key),'技能来源不在阵中或本战已用');
      const skill=definition(source).skill;
      if(skill==='xia_hou_dun'||skill==='zhao_yun'){
        const weapons=Object.keys(legacyEquipment).filter(weapon=>legacyEquipment[weapon]===source);
        check(weapons.includes(target)&&(skill!=='zhao_yun'||weapons.length===2),'旧自动技能选择不合法');
      }else if(skill==='pang_tong'&&slots.filter(id=>id&&definition(id).type==='tactic').length===1){
        check(slots.includes(target)&&definition(target).type==='tactic','连环目标不合法');
      }else{
        const choice=choices.find(item=>item.key===key);check(choice&&(choice.options.some(item=>item.id===target)||(choice.optional&&target==='')),'技能选择不合法');
      }
    }
  }
  array(value.battles,18);const completed=value.phase==='battle'?value.battleIndex:Number(value.battleIndex)+1;check(value.battles.length===completed,'已完成战斗与进度不一致');
  for(let i=0;i<value.battles.length;i++){
    const item=value.battles[i];record(item);check(item.index===i&&item.enemyId===ENEMIES[i]!.id,'战斗记录顺序错误');bool(item.won);integer(item.plays,1,4);integer(item.discards,0,3);integer(item.remainingHp);check(item.won?item.remainingHp===0:Number(item.remainingHp)>0,'战斗胜负与血量不一致');check(item.won||value.phase==='lost'&&i===value.battles.length-1,'失败后仍继续冒险');array(item.reports,4);item.reports.forEach(report);check(item.reports.length===item.plays,'出战记录数量不一致');for(const entry of item.reports)for(const cardId of (entry as BattleReport).playedIds)anyRef(cardId);
  }
  if(value.phase==='lost')check((value.battles.at(-1) as Record<string,unknown> | undefined)?.won===false,'失败阶段必须对应末场失败记录');
  else check(value.battles.every(item=>(item as Record<string,unknown>).won===true),'非失败阶段含失败记录');
  if(value.phase==='won')check(value.battleIndex===17&&value.battles.length===18,'终局进度错误');else if(value.phase!=='lost')check(value.battleIndex<17||value.phase==='battle','最终战后出现奖励');
  const cap=maxCharmTier(value as unknown as RunState);check((value.charms as RunState['charms']).every(c=>!c||c.tier!<=cap),'锦囊阶数尚未解锁');
  integer(value.nextId,1,1_000_000);check(Number(value.revision)>=value.receipts.length,'回执多于修订次数');
  const instanceIds=[...ids,...charmIds,...enhancementIds,...charmRewardIds,...logIds];
  if(value.reward)instanceIds.push((value.reward as Record<string,string>).id!);
  if(value.market){const market=value.market as Record<string,unknown>;instanceIds.push(market.id as string,...(market.items as Record<string,string>[]).map(item=>item.id!));}
  check(new Set(instanceIds).size===instanceIds.length,'实体标识冲突');
  check(instanceIds.every(instanceId=>/^(card|charm|enhance|log|reward|market|item)-[1-9][0-9]*$/.test(instanceId)&&Number(instanceId.split('-').at(-1))<Number(value.nextId)),'实体计数器错误');
}
export function parseRun(serialized:string):RunState {
  check(typeof serialized==='string'&&serialized.length>0&&serialized.length<=MAX_BYTES,'文件为空或过大');
  let parsed:unknown;try{parsed=JSON.parse(serialized);}catch{throw new Error('存档不是有效 JSON');}
  if(typeof parsed==='object'&&parsed!==null&&'contentVersion' in parsed&&parsed.contentVersion===LEGACY_CONTENT_VERSION)return legacy.parseRun(serialized);
  validate(parsed);
  if(parsed.phase==='enhanceReward'&&parsed.enhancements.some(o=>o.targetIds!==undefined)){
    createEnhancements(parsed);validate(parsed);
  }
  if(parsed.battle){
    parsed.battle.equipment={};
    const tactics=parsed.battle.slots.filter(id=>id&&CARD_MAP[parsed.cards[id]!.definitionId]!.type==='tactic');
    for(const key of Object.keys(parsed.battle.targets)){
      const skill=CARD_MAP[parsed.cards[key.slice(6)]!.definitionId]!.skill;
      if(skill==='xia_hou_dun'||skill==='zhao_yun'||skill==='pang_tong'&&tactics.length===1)delete parsed.battle.targets[key];
    }
  }
  return parsed;
}
export function serializeRun(state:RunState):string {if(state.contentVersion===LEGACY_CONTENT_VERSION)return legacy.serializeRun(state);validate(state);const serialized=JSON.stringify(state);check(serialized.length<=MAX_BYTES,'文件过大');return serialized;}
