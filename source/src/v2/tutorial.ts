import { act, createLegacyRun as createRun } from './engine';
import { previewBattle } from './battle';
import { CARD_MAP } from './data';
import { cloneRun } from './model';
import type { CardType, GameAction, RunState } from './model';
import { parseRun, serializeRun } from './persistence';

/** Keep the storage namespace so valid earlier lessons can be migrated in memory. */
export const TUTORIAL_KEY='three_kingdoms.tutorial.mobile_v2.v1';
const STEPS=['intro','select-character','place-character','select-weapon','place-weapon-gap','select-staged-weapon','move-weapon','compare','drag-weapon','select-tactic','place-tactic','damage','damage-read','play','reward','enhance','camp','practice-discard','practice-pick-discard','practice-confirm-discard','practice','complete','skipped'] as const;
export type TutorialStep=typeof STEPS[number];
export interface TutorialSession {
  version:2; step:TutorialStep; run:RunState; checkpoint:RunState; seenTypes:CardType[];
  damageRead:boolean; gapDamage:number|null; practiceDiscarded:boolean; hints:number; attempts:number;
  migrationNotice?:string;
}
export type TutorialEvent=
  |{type:'next'}|{type:'inspect';definitionId:string}|{type:'breakdown'}|{type:'close-breakdown'}
  |{type:'select';cardId:string;fromSlot:number|null}|{type:'discard-open'}|{type:'discard-select';cardId:string}
  |{type:'action';action:GameAction;input?:'click'|'drag'|'keyboard'}|{type:'retry'}|{type:'hint'}|{type:'skip'};
const FIXED={character:'three_kingdoms.character.shu_zhong_meng_shi',weapon:'three_kingdoms.weapon.huan_shou_dao',tactic:'three_kingdoms.tactic.chou_cuo_jun_liang'} as const;
const SEED='tutorial-v1-fixed';
const practiceStep=(step:TutorialStep)=>step.startsWith('practice');
function fixed(run:RunState,kind:keyof typeof FIXED):string {
  const card=run.owned.find(id=>run.cards[id]!.definitionId===FIXED[kind]);
  if(!card)throw new Error('演武缺少指定卡牌');
  return card;
}
/** The discard target always comes from the untouched second-battle checkpoint. */
export function tutorialCard(s:TutorialSession,kind:keyof typeof FIXED|'discard'):string {
  if(kind==='discard') {
    const id=s.checkpoint.battle?.hand[7];if(!id)throw new Error('演武缺少指定弃牌');
    return id;
  }
  return fixed(s.run,kind);
}
function trainingHand(run:RunState,practice=false):void {
  const first=Object.keys(FIXED).map(kind=>fixed(run,kind as keyof typeof FIXED));
  if(practice){const legendary=run.owned.find(id=>CARD_MAP[run.cards[id]!.definitionId]!.rarity==='legendary');if(legendary)first.push(legendary);}
  if(run.leaderId)first.push(run.leaderId);
  const order=[...new Set([...first,...run.owned.filter(id=>!run.removed.includes(id))])];
  run.battle!.hand=order.slice(0,8);run.battle!.draw=order.slice(8);run.battle!.hp=practice?240:100;
}
export function createTutorial():TutorialSession {
  const run=createRun('bai_zhan_cui_bing','three_kingdoms.character.zhao_yun',SEED);
  trainingHand(run);
  return {version:2,step:'intro',run,checkpoint:cloneRun(run),seenTypes:[],damageRead:false,gapDamage:null,practiceDiscarded:false,hints:0,attempts:0};
}
export function tutorialHealth(s:TutorialSession):100|240{return s.run.battleIndex===0?100:240;}
export function tutorialReady(s:TutorialSession):boolean{return s.step==='intro'||s.step==='compare';}
const selectTargets:Partial<Record<TutorialStep,[keyof typeof FIXED,number|null]>>={
  'select-character':['character',null],'select-weapon':['weapon',null],'select-staged-weapon':['weapon',3],'select-tactic':['tactic',null],
};
const stageTargets:Partial<Record<TutorialStep,[keyof typeof FIXED,number]>>={
  'place-character':['character',1],'place-weapon-gap':['weapon',3],'move-weapon':['weapon',2],'drag-weapon':['weapon',0],'place-tactic':['tactic',3],
};
function allowed(s:TutorialSession,e:Extract<TutorialEvent,{type:'action'}>):boolean {
  const a=e.action,stage=stageTargets[s.step];
  if(e.input!==undefined&&!['click','drag','keyboard'].includes(e.input))return false;
  if(stage)return a.type==='stage'&&a.cardId===tutorialCard(s,stage[0])&&a.slot===stage[1]&&(s.step!=='drag-weapon'||e.input==='drag'||e.input==='keyboard');
  if(s.step==='play')return a.type==='play';
  if(s.step==='reward')return a.type==='chooseCard'&&a.definitionId!==null;
  if(s.step==='enhance')return a.type==='chooseEnhancement';
  if(s.step==='camp')return a.type==='nextBattle';
  if(s.step==='practice-confirm-discard')return a.type==='discard'&&a.cardIds.length===1&&a.cardIds[0]===tutorialCard(s,'discard');
  return s.step==='practice'&&s.run.phase==='battle'&&['stage','unstage','reorderHand','recallAll','equip','target','discard','play'].includes(a.type);
}
export function updateTutorial(input:TutorialSession,event:TutorialEvent):{ok:boolean;session:TutorialSession;error?:string} {
  const fail=(error='请先完成当前高亮操作')=>({ok:false,session:input,error});
  if(input.step==='complete'||input.step==='skipped')return fail('演武已结束');
  const s=structuredClone(input);
  const advance=()=>{s.step=STEPS[STEPS.indexOf(s.step)+1]!;if(!practiceStep(s.step)&&s.step!=='complete')s.checkpoint=cloneRun(s.run);};
  const see=(id:string)=>{const type=CARD_MAP[s.run.cards[id]!.definitionId]!.type;if(!s.seenTypes.includes(type))s.seenTypes.push(type);};
  switch(event.type){
    case 'skip':s.step='skipped';break;
    case 'hint':if(s.hints>=1_000_000)return {ok:true,session:input};s.hints++;break;
    case 'retry':
      if(['reward','enhance','camp'].includes(s.step)||s.attempts>=1_000_000)return fail('当前阶段不能重练');
      s.run=cloneRun(s.checkpoint);s.attempts++;
      if(practiceStep(s.step)){s.step='practice-discard';s.practiceDiscarded=false;}
      if(s.step==='damage-read'){s.step='damage';s.damageRead=false;}
      break;
    case 'inspect':{
      const def=CARD_MAP[event.definitionId];
      if(!def||!s.run.owned.some(id=>s.run.cards[id]!.definitionId===event.definitionId))return fail('演武中没有这张卡');
      if(s.seenTypes.includes(def.type))return {ok:true,session:input};s.seenTypes.push(def.type);break;
    }
    case 'next':if(!tutorialReady(s))return fail();advance();break;
    case 'select':{
      const target=selectTargets[s.step];
      if(target){
        const id=tutorialCard(s,target[0]);
        if(event.cardId!==id||event.fromSlot!==target[1])return fail();
        if(target[1]===null?!s.run.battle?.hand.includes(id):s.run.battle?.slots[target[1]]!==id)return fail();
        see(id);advance();
      }else if(s.step==='practice'){
        const b=s.run.battle;if(!b||(event.fromSlot===null?!b.hand.includes(event.cardId):b.slots[event.fromSlot]!==event.cardId))return fail();
        see(event.cardId);
      }else return fail();
      break;
    }
    case 'breakdown':if(s.step!=='damage')return fail();s.damageRead=true;advance();break;
    case 'close-breakdown':if(s.step!=='damage-read')return fail();advance();break;
    case 'discard-open':if(s.step!=='practice-discard')return fail();advance();break;
    case 'discard-select':if(s.step!=='practice-pick-discard'||event.cardId!==tutorialCard(s,'discard'))return fail();see(event.cardId);advance();break;
    case 'action':{
      if(!allowed(s,event))return fail();
      const result=act(s.run,event.action);if(!result.ok)return fail(result.error??'操作失败');s.run=result.state;
      if(s.step==='place-weapon-gap')s.gapDamage=previewBattle(s.run).report!.damage;
      if(s.step==='practice-confirm-discard'){s.practiceDiscarded=true;advance();}
      else if(s.step==='practice'){if(s.run.phase==='cardReward')s.step='complete';}
      else if(s.step==='camp'){trainingHand(s.run,true);s.step='practice-discard';s.practiceDiscarded=false;s.checkpoint=cloneRun(s.run);}
      else advance();
      break;
    }
    default:return fail();
  }
  return {ok:true,session:s};
}

function check(condition:unknown,message:string):asserts condition {if(!condition)throw new Error('演武存档无效：'+message);}
function same(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x);
  return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));
}
function execute(run:RunState,action:GameAction):RunState {const result=act(run,action);if(!result.ok)throw new Error(result.error!);return result.state;}
/** Canonical engine results also validate fixed formations and untouched lesson checkpoints. */
let canonicalCache:{steps:Partial<Record<TutorialStep,RunState>>;practice:RunState[];enhance:RunState[];camp:RunState[];gap:number}|undefined;
function canonical(){
  if(canonicalCache)return canonicalCache;
  let run=createTutorial().run;
  const steps:Partial<Record<TutorialStep,RunState>>={};
  const put=(...names:TutorialStep[])=>{for(const name of names)steps[name]=run;};
  put('intro','select-character','place-character');
  run=execute(run,{type:'stage',cardId:fixed(run,'character'),slot:1});put('select-weapon','place-weapon-gap');
  run=execute(run,{type:'stage',cardId:fixed(run,'weapon'),slot:3});put('select-staged-weapon','move-weapon');
  const gap=previewBattle(run).report!.damage;
  run=execute(run,{type:'stage',cardId:fixed(run,'weapon'),slot:2});put('compare','drag-weapon');
  run=execute(run,{type:'stage',cardId:fixed(run,'weapon'),slot:0});put('select-tactic','place-tactic');
  run=execute(run,{type:'stage',cardId:fixed(run,'tactic'),slot:3});put('damage','damage-read','play');
  run=execute(run,{type:'play'});put('reward');
  const practice:RunState[]=[],enhance:RunState[]=[],camp:RunState[]=[];
  for(const definitionId of run.reward!.candidates){
    const choice=execute(run,{type:'chooseCard',definitionId});enhance.push(choice);
    for(const option of choice.enhancements){
      const enhanced=execute(choice,{type:'chooseEnhancement',optionId:option.id});camp.push(enhanced);
      const next=execute(enhanced,{type:'nextBattle'});trainingHand(next,true);practice.push(next);
    }
  }
  canonicalCache={steps,practice,enhance,camp,gap};return canonicalCache;
}
const OLD_STEPS=['intro','inspect','character','weapon-gap','weapon-fit','tactic','damage','play','reward','enhance','camp','practice','complete','skipped'];
function common(s:TutorialSession):void {
  check(s&&typeof s==='object'&&!Array.isArray(s),'格式错误');
  check(Array.isArray(s.seenTypes)&&s.seenTypes.length<=3&&new Set(s.seenTypes).size===s.seenTypes.length&&s.seenTypes.every(t=>['character','weapon','tactic'].includes(t)),'查看记录错误');
  check(typeof s.damageRead==='boolean'&&typeof s.practiceDiscarded==='boolean','标记错误');
  check([s.hints,s.attempts].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000),'计数错误');
  check(s.gapDamage===null||(Number.isSafeInteger(s.gapDamage)&&s.gapDamage>=0),'伤害记录错误');
  check(s.migrationNotice===undefined||(typeof s.migrationNotice==='string'&&s.migrationNotice.length>0&&s.migrationNotice.length<=200),'迁移说明错误');
  s.run=parseRun(JSON.stringify(s.run));s.checkpoint=parseRun(JSON.stringify(s.checkpoint));
  const initial=createTutorial().run;
  for(const run of [s.run,s.checkpoint]){
    check(run.seed===SEED&&run.battleIndex<=1&&run.deckId==='bai_zhan_cui_bing'&&run.difficulty==='standard','不是演武进度');
    // Ownership is historical: 吕布 can lawfully move a character to removed
    // on victory. parseRun validates those references and the active zones;
    // canonical lesson/checkpoint validation still forbids early removals.
    check(run.runId===initial.runId&&run.owned.length>=initial.owned.length&&run.owned.length<=initial.owned.length+1,'演武牌组或标识错误');
    check(initial.owned.every((id,i)=>run.owned[i]===id&&run.cards[id]!.definitionId===initial.cards[id]!.definitionId),'演武初始牌组错误');
    for(const kind of Object.keys(FIXED))fixed(run,kind as keyof typeof FIXED);
    if(run.battle)check(run.battle.hp<=(run.battleIndex===0?100:240),'训练耐久错误');
  }
}
function validateLegacy(s:TutorialSession):void {
  const step=s.step as string,index=OLD_STEPS.indexOf(step);check(index>=0,'旧版步骤错误');
  if(step!=='skipped'){
    if(index>1)check(s.seenTypes.length===3,'旧版缺少查看记录');
    if(index>=4)check(s.gapDamage!==null,'旧版缺少伤害记录');
    const expected=step==='practice'||step==='complete'?1:0;check(s.run.battleIndex===expected,'旧版战次错误');
    const phase=step==='reward'?'cardReward':step==='enhance'?'enhanceReward':step==='camp'?'camp':step==='complete'?'cardReward':step==='practice'?null:'battle';
    if(phase)check(s.run.phase===phase,'旧版阶段错误');
    if(step==='practice')check(['battle','lost'].includes(s.run.phase),'旧版练习阶段错误');
    check(s.checkpoint.battleIndex===s.run.battleIndex&&s.checkpoint.phase===(step==='practice'?'battle':s.run.phase),'旧版重练点错误');
  }
}
function validateV2(s:TutorialSession):void {
  check(s.version===2&&STEPS.includes(s.step),'步骤错误');
  if(s.step==='skipped'){
    check(s.checkpoint.battleIndex===s.run.battleIndex&&s.checkpoint.phase===(s.run.phase==='lost'?'battle':s.run.phase),'跳过时的重练点错误');
    return;
  }
  // v1 completion has a terminal checkpoint and different legitimate lesson
  // metadata. Keep validating it under the original completion contract.
  if(s.step==='complete'&&same(s.checkpoint,s.run)){validateLegacy(s);return;}
  const c=canonical(),index=STEPS.indexOf(s.step);
  const seenRequired:CardType[]=[];
  if(index>=2)seenRequired.push('character');
  if(index>=4)seenRequired.push('weapon');
  if(index>=10)seenRequired.push('tactic');
  check(seenRequired.every(t=>s.seenTypes.includes(t)),'缺少指定卡牌的选择记录');
  check(index>=5?s.gapDamage===c.gap:s.gapDamage===null,'配属前伤害记录错误');
  check(s.damageRead===(index>=12),'明细阅读记录错误');
  if(index<17){
    const expected=c.steps[s.step];
    check(expected?same(s.run,expected):s.step==='enhance'?c.enhance.some(r=>same(r,s.run)):s.step==='camp'&&c.camp.some(r=>same(r,s.run)),'步骤、阶段或指定阵形错误');
    check(same(s.checkpoint,s.run),'教学重练点与当前步骤不符');check(!s.practiceDiscarded,'尚未进入弃牌练习');
    return;
  }
  check(s.run.battleIndex===1,'练习战次错误');
  check(c.practice.some(r=>same(r,s.checkpoint)),'练习重练点不是初始第二场');
  check(same(s.run.battles[0],s.checkpoint.battles[0])&&same(s.run.owned,s.checkpoint.owned),'练习改写了首场记录或所有权');
  if(index<20){check(same(s.run,s.checkpoint)&&!s.practiceDiscarded,'弃牌前练习进度错误');return;}
  check(s.practiceDiscarded,'尚未实际完成弃牌');
  if(s.step==='complete')check(s.run.phase==='cardReward','演武尚未获胜');
  else check(s.run.phase==='battle'||s.run.phase==='lost','自由练习阶段错误');
  const battle=s.run.battle;
  const reports=battle?s.run.currentReports:s.run.battles[1]!.reports;
  const hp=battle?battle.hp:s.run.battles[1]!.remainingHp;
  const discards=battle?battle.activeDiscards:s.run.battles[1]!.discards;
  check(discards>=1&&hp+reports.reduce((sum,r)=>sum+r.actualDamage,0)===240,'练习耐久或实际弃牌记录错误');
}
export function parseTutorial(serialized:string):TutorialSession {
  check(typeof serialized==='string'&&serialized.length>0&&serialized.length<=4_100_000,'文件为空或过大');
  const s=JSON.parse(serialized) as TutorialSession;
  common(s);
  if((s.version as number)===1){
    validateLegacy(s);
    if(s.step==='complete'||s.step==='skipped')return {...s,version:2};
    return {...createTutorial(),migrationNotice:'新手演武已升级，已为你从新的操作引导开始。'};
  }
  validateV2(s);return s;
}
export function serializeTutorial(s:TutorialSession):string {
  serializeRun(s.run);serializeRun(s.checkpoint);check(s.version===2,'保存必须使用新版教学');
  const result=JSON.stringify(s);parseTutorial(result);return result;
}
