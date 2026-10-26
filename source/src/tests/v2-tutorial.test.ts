import { describe, expect, it } from 'vitest';
import { createTutorial, parseTutorial, serializeTutorial, tutorialCard, tutorialReady, updateTutorial } from '../v2/tutorial';
import { CARD_MAP } from '../v2/data';
import { previewBattle } from '../v2/battle';
import { act } from '../v2/engine';
import type { GameAction } from '../v2/model';
import type { TutorialEvent, TutorialSession } from '../v2/tutorial';

function send(s:TutorialSession,event:TutorialEvent):TutorialSession {
  const result=updateTutorial(s,event);expect(result.error).toBeUndefined();expect(result.ok).toBe(true);
  return parseTutorial(serializeTutorial(result.session));
}
const action=(s:TutorialSession,a:GameAction,input:'click'|'drag'|'keyboard'='click')=>send(s,{type:'action',action:a,input});
const select=(s:TutorialSession,kind:'character'|'weapon'|'tactic',fromSlot:number|null=null)=>send(s,{type:'select',cardId:tutorialCard(s,kind),fromSlot});
function firstBattle():TutorialSession {
  let s=send(createTutorial(),{type:'next'});
  s=select(s,'character');s=action(s,{type:'stage',cardId:tutorialCard(s,'character'),slot:1});
  s=select(s,'weapon');s=action(s,{type:'stage',cardId:tutorialCard(s,'weapon'),slot:3});
  expect(s.gapDamage).toBe(previewBattle(s.run).report!.damage);
  s=select(s,'weapon',3);s=action(s,{type:'stage',cardId:tutorialCard(s,'weapon'),slot:2});
  expect(s.step).toBe('compare');expect(tutorialReady(s)).toBe(true);
  expect(previewBattle(s.run).report!.damage).toBeGreaterThan(s.gapDamage!);
  s=send(s,{type:'next'});s=action(s,{type:'stage',cardId:tutorialCard(s,'weapon'),slot:0},'drag');
  s=select(s,'tactic');s=action(s,{type:'stage',cardId:tutorialCard(s,'tactic'),slot:3});
  s=send(s,{type:'breakdown'});expect(s.step).toBe('damage-read');
  s=send(s,{type:'close-breakdown'});expect(s.step).toBe('play');
  return action(s,{type:'play'});
}
function practice():TutorialSession {
  let s=firstBattle();s=action(s,{type:'chooseCard',definitionId:s.run.reward!.candidates[0]!});
  const option=s.run.enhancements.find(o=>CARD_MAP[s.run.cards[o.targetId]!.definitionId]!.skill!=='')!;
  return action(action(s,{type:'chooseEnhancement',optionId:option.id}),{type:'nextBattle'});
}
function discard(s:TutorialSession):TutorialSession {
  s=send(s,{type:'discard-open'});s=send(s,{type:'discard-select',cardId:tutorialCard(s,'discard')});
  return action(s,{type:'discard',cardIds:[tutorialCard(s,'discard')]});
}
function winPractice(s:TutorialSession):TutorialSession {
  for(let round=0;round<4&&s.step==='practice';round++){
    for(const [slot,id] of s.run.battle!.hand.slice(0,5).entries())s=action(s,{type:'stage',cardId:id,slot});
    for(const choice of previewBattle(s.run).choices)s=action(s,{type:choice.key.startsWith('equip:')?'equip':'target',...(choice.key.startsWith('equip:')?{weaponId:choice.key.slice(6)}:{key:choice.key}),targetId:choice.options[0]?.id??''} as GameAction);
    s=action(s,{type:'play'});
  }
  return s;
}
function reject(s:TutorialSession,event:TutorialEvent):void {
  const before=structuredClone(s),result=updateTutorial(s,event);
  expect(result.ok).toBe(false);expect(result.session).toBe(s);expect(s).toEqual(before);
}

describe('forced tutorial domain',()=>{
  it('creates repeatable real eight-card training without changing formal maxHp',()=>{
    const s=createTutorial();expect(s.version).toBe(2);expect(s).toEqual(createTutorial());
    expect(s.run.battle!.hand).toHaveLength(8);expect(s.run.battle!.hp).toBe(100);expect(s.run.battle!.maxHp).toBeGreaterThan(100);
    expect(parseTutorial(serializeTutorial(s))).toEqual(s);
  });
  it('requires exact selections, cards and slots and advances automatically',()=>{
    let s=createTutorial();reject(s,{type:'action',action:{type:'play'}});
    s=send(s,{type:'next'});expect(s.step).toBe('select-character');expect(tutorialReady(s)).toBe(false);
    reject(s,{type:'next'});reject(s,{type:'select',cardId:tutorialCard(s,'weapon'),fromSlot:null});
    reject(s,{type:'select',cardId:tutorialCard(s,'character'),fromSlot:1});
    s=select(s,'character');expect(s.step).toBe('place-character');expect(s.seenTypes).toContain('character');
    for(const slot of [0,2,3,4])reject(s,{type:'action',action:{type:'stage',cardId:tutorialCard(s,'character'),slot}});
    reject(s,{type:'action',action:{type:'stage',cardId:tutorialCard(s,'weapon'),slot:1}});
    s=action(s,{type:'stage',cardId:tutorialCard(s,'character'),slot:1});expect(s.step).toBe('select-weapon');
    expect(s.checkpoint).toEqual(s.run);reject(s,{type:'action',action:{type:'discard',cardIds:[s.run.battle!.hand[0]!]}});
  });
  it('blocks wrong targets at every fixed-card lesson and keeps each completed operation checkpoint',()=>{
    let s=send(createTutorial(),{type:'next'});
    const sequence:TutorialEvent[]=[
      {type:'select',cardId:tutorialCard(s,'character'),fromSlot:null},
      {type:'action',action:{type:'stage',cardId:tutorialCard(s,'character'),slot:1}},
      {type:'select',cardId:tutorialCard(s,'weapon'),fromSlot:null},
      {type:'action',action:{type:'stage',cardId:tutorialCard(s,'weapon'),slot:3}},
      {type:'select',cardId:tutorialCard(s,'weapon'),fromSlot:3},
      {type:'action',action:{type:'stage',cardId:tutorialCard(s,'weapon'),slot:2}},
      {type:'next'},
      {type:'action',action:{type:'stage',cardId:tutorialCard(s,'weapon'),slot:0},input:'keyboard'},
      {type:'select',cardId:tutorialCard(s,'tactic'),fromSlot:null},
      {type:'action',action:{type:'stage',cardId:tutorialCard(s,'tactic'),slot:3}},
    ];
    for(const event of sequence){
      if(event.type==='select'){
        reject(s,{...event,cardId:s.run.leaderId!});
        reject(s,{...event,fromSlot:event.fromSlot===null?0:null});
      }else if(event.type==='action'&&event.action.type==='stage'){
        reject(s,{...event,action:{...event.action,cardId:s.run.leaderId!}});
        for(let slot=0;slot<5;slot++)if(slot!==event.action.slot)reject(s,{...event,action:{...event.action,slot}});
      }
      s=send(s,event);expect(s.checkpoint).toEqual(s.run);
      expect(send(s,{type:'retry'}).run).toEqual(s.run);
    }
    expect(s.step).toBe('damage');
  });
  it.each(['drag','keyboard'] as const)('requires real movement input (%s) and closes the damage lesson',input=>{
    let s=send(createTutorial(),{type:'next'});s=select(s,'character');s=action(s,{type:'stage',cardId:tutorialCard(s,'character'),slot:1});
    s=select(s,'weapon');s=action(s,{type:'stage',cardId:tutorialCard(s,'weapon'),slot:3});
    s=select(s,'weapon',3);s=action(s,{type:'stage',cardId:tutorialCard(s,'weapon'),slot:2});s=send(s,{type:'next'});
    const move:GameAction={type:'stage',cardId:tutorialCard(s,'weapon'),slot:0};
    reject(s,{type:'action',action:move,input:'click'});reject(s,{type:'action',action:move});
    s=action(s,move,input);expect(s.step).toBe('select-tactic');
    s=select(s,'tactic');s=action(s,{type:'stage',cardId:tutorialCard(s,'tactic'),slot:3});
    reject(s,{type:'close-breakdown'});s=send(s,{type:'breakdown'});
    const retried=send(s,{type:'retry'});expect(retried.step).toBe('damage');expect(retried.damageRead).toBe(false);
    reject(s,{type:'next'});s=send(s,{type:'close-breakdown'});expect(s.step).toBe('play');
  });
  it('uses real rewards/enhancement, requires the initial eighth-card discard, and wins both battles',()=>{
    let s=practice();expect(s.step).toBe('practice-discard');expect(s.run.battle!.hp).toBe(240);
    const target=s.run.battle!.hand[7]!;expect(tutorialCard(s,'discard')).toBe(target);
    reject(s,{type:'action',action:{type:'play'}});reject(s,{type:'discard-select',cardId:target});
    s=send(s,{type:'discard-open'});expect(s.step).toBe('practice-pick-discard');
    reject(s,{type:'discard-select',cardId:s.run.battle!.hand[0]!});s=send(s,{type:'discard-select',cardId:target});
    reject(s,{type:'action',action:{type:'discard',cardIds:[target,s.run.battle!.hand[0]!]}});
    s=action(s,{type:'discard',cardIds:[target]});expect(s.step).toBe('practice');expect(s.practiceDiscarded).toBe(true);
    s=winPractice(s);expect(s.step).toBe('complete');expect(s.run.battles).toHaveLength(2);expect(s.run.battles.every(b=>b.won)).toBe(true);
  });
  it('reloads real practice loss and resets to its initial checkpoint with discard required again',()=>{
    let s=practice();const checkpoint=structuredClone(s.run);s=discard(s);
    for(let round=0;round<4;round++){
      const id=s.run.battle!.hand.find(id=>{const d=CARD_MAP[s.run.cards[id]!.definitionId]!;return d.type==='character'&&d.skill===''&&s.run.cards[id]!.permanentPower===0;})!;
      expect(id).toBeDefined();s=action(s,{type:'stage',cardId:id,slot:2});s=action(s,{type:'play'});
    }
    expect(s.run.phase).toBe('lost');expect(s.run.battles[1]!.won).toBe(false);s=send(s,{type:'retry'});
    expect(s.step).toBe('practice-discard');expect(s.run).toEqual(checkpoint);expect(s.practiceDiscarded).toBe(false);
    reject(s,{type:'action',action:{type:'play'}});expect(discard(s).practiceDiscarded).toBe(true);
  });
  it('retries every discard substep from the same initial practice battle and reproduces real draws',()=>{
    const initial=practice();let s=initial;
    const target=tutorialCard(s,'discard');
    for(const event of [{type:'discard-open'},{type:'discard-select',cardId:target},{type:'action',action:{type:'discard',cardIds:[target]}}] as TutorialEvent[]){
      s=send(s,event);expect(s.checkpoint).toEqual(initial.run);
      const retried=send(s,{type:'retry'});expect(retried.step).toBe('practice-discard');expect(retried.run).toEqual(initial.run);
      expect(discard(retried).run).toEqual(discard(initial).run);
    }
  });
  it('saves and retries real practice after 吕布 permanently swallows a right-hand card',()=>{
    let s=firstBattle();
    const definitionId='three_kingdoms.character.lv_bu';
    expect(s.run.reward!.candidates).toContain(definitionId);
    s=action(s,{type:'chooseCard',definitionId});
    s=action(s,{type:'chooseEnhancement',optionId:s.run.enhancements[0]!.id});
    s=action(s,{type:'nextBattle'});const initial=structuredClone(s);s=discard(s);
    const lvbu=s.run.battle!.hand.find(id=>s.run.cards[id]!.definitionId===definitionId)!;
    const victim=tutorialCard(s,'character');
    expect(lvbu).toBeDefined();
    s=action(s,{type:'stage',cardId:lvbu,slot:0});
    s=action(s,{type:'stage',cardId:victim,slot:1});
    s=action(s,{type:'play'});
    expect(s.run.battle!.swallow).toContainEqual(expect.objectContaining({sourceId:lvbu,targetId:victim}));
    s=send(s,{type:'retry'});expect(s.run).toEqual(initial.run);
    expect(s.step).toBe('practice-discard');
    s=discard(s);
    s=action(s,{type:'stage',cardId:lvbu,slot:0});
    s=action(s,{type:'stage',cardId:victim,slot:1});
    s=action(s,{type:'stage',cardId:tutorialCard(s,'weapon'),slot:2});
    s=action(s,{type:'stage',cardId:tutorialCard(s,'tactic'),slot:3});
    const result=updateTutorial(s,{type:'action',action:{type:'play'}});
    expect(result.ok).toBe(true);expect(result.session.run.removed).toContain(victim);
    s=parseTutorial(serializeTutorial(result.session));
    expect(s.step).toBe('complete');
    expect(s.run.owned).toContain(victim);expect(s.checkpoint.removed).toEqual([]);
    const legacy={...s,version:1,step:s.step==='complete'?'complete':'practice',checkpoint:s.step==='complete'?s.run:s.checkpoint};
    const migrated=parseTutorial(JSON.stringify(legacy));
    if(s.step==='complete')expect(migrated.run).toEqual(s.run);
    else expect(migrated.step).toBe('intro');
    const oldSkipped=parseTutorial(JSON.stringify({...legacy,step:'skipped'}));
    expect(oldSkipped.run.removed).toContain(victim);
    expect(parseTutorial(serializeTutorial(oldSkipped))).toEqual(oldSkipped);
  });
  it('records inspection without progression and preserves exact input on wrong or duplicate events',()=>{
    let s=createTutorial();const e:TutorialEvent={type:'inspect',definitionId:s.run.cards[s.run.battle!.hand[0]!]!.definitionId};
    s=send(s,e);expect(s.step).toBe('intro');expect(updateTutorial(s,e).session).toBe(s);
    reject(s,{type:'breakdown'});reject(s,{type:'inspect',definitionId:'garbage'});
    s=firstBattle();reject(s,{type:'retry'});reject(s,{type:'action',action:{type:'chooseCard',definitionId:null}});
  });
  it('rejects forged steps, metadata, fixed cards, phases and checkpoints',()=>{
    const initial=createTutorial(),reward=firstBattle(),p=practice();
    for(const patch of [{version:3},{step:'garbage'},{hints:-1},{seenTypes:['oops']},{run:{}},{migrationNotice:7},{step:'play'}])expect(()=>parseTutorial(JSON.stringify({...initial,...patch}))).toThrow();
    for(const patch of [{gapDamage:null},{damageRead:false},{seenTypes:['character']},{checkpoint:initial.run}])expect(()=>parseTutorial(JSON.stringify({...reward,...patch}))).toThrow();
    const corrupt=structuredClone(initial);corrupt.run.cards[tutorialCard(corrupt,'weapon')]!.definitionId='three_kingdoms.weapon.qing_gang_jian';expect(()=>parseTutorial(JSON.stringify(corrupt))).toThrow();
    const wrongSlot=send(initial,{type:'next'});wrongSlot.step='select-weapon';expect(()=>parseTutorial(JSON.stringify(wrongSlot))).toThrow();
    const wrongSkipped={...initial,step:'skipped',checkpoint:p.run};expect(()=>parseTutorial(JSON.stringify(wrongSkipped))).toThrow();
    p.checkpoint.battle!.hp=239;expect(()=>parseTutorial(JSON.stringify(p))).toThrow();
  });
  it('migrates only valid v1 saves, restarting active lessons and preserving ended runs',()=>{
    const base=createTutorial(),legacy={...base,version:1,step:'intro'};
    const loaded=parseTutorial(JSON.stringify(legacy));expect(loaded.version).toBe(2);expect(loaded.step).toBe('intro');expect(loaded.migrationNotice).toBeTruthy();
    expect(parseTutorial(JSON.stringify({...legacy,step:'skipped'})).run).toEqual(base.run);
    const completed=winPractice(discard(practice()));
    // v1 allowed retrying the play checkpoint to clear damageRead and accepted
    // different legal formations, whose gap preview differs from the new lesson.
    const oldComplete={...completed,version:1,checkpoint:completed.run,damageRead:false,gapDamage:17};
    const migratedComplete=parseTutorial(JSON.stringify(oldComplete));
    expect(migratedComplete.run).toEqual(completed.run);
    expect(parseTutorial(serializeTutorial(migratedComplete))).toEqual(migratedComplete);
    const oldPractice={...practice(),version:1,step:'practice'};
    expect(parseTutorial(JSON.stringify(oldPractice)).step).toBe('intro');
    // A fixture produced using v1's real, freely chosen formation and step names.
    let run=act(base.run,{type:'stage',cardId:tutorialCard(base,'character'),slot:0}).state;
    run=act(run,{type:'stage',cardId:tutorialCard(base,'weapon'),slot:4}).state;
    const gapDamage=previewBattle(run).report!.damage;
    const oldFit={...legacy,step:'weapon-fit',seenTypes:['character','weapon','tactic'],gapDamage,run,checkpoint:structuredClone(run)};
    expect(parseTutorial(JSON.stringify(oldFit)).migrationNotice).toBeTruthy();
    for(const patch of [{step:'nonsense'},{seenTypes:[],step:'weapon-fit'},{run:{}},{checkpoint:{}},{hints:-2},{step:'complete'}])expect(()=>parseTutorial(JSON.stringify({...legacy,...patch}))).toThrow();
  });
});
