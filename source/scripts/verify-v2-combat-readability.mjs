import fs from 'node:fs/promises';
const page=(await(await fetch('http://127.0.0.1:9458/json/list')).json()).find(p=>p.type==='page');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let seq=0;const pending=new Map();
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const click=async text=>{await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(${JSON.stringify(text)}));if(!b)throw Error('missing '+${JSON.stringify(text)});b.click()})()`);await delay(100);};
const wait=async selector=>{for(let i=0;i<100;i++){if(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`))return;await delay(100);}throw Error('missing '+selector);};
const output = 'docs/完整游戏/截图/战斗信息增强';
await fs.mkdir(output, {recursive:true});
const checks=[];
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const bounds=()=>evaluate(`(()=>{const selectors=['.v2-formation','.v2-formation-scroll','.v2-hand','.v2-preview','.v2-play'];return Object.fromEntries(selectors.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return[s,[r.x,r.y,r.width,r.height]]}));})()`);
let observedMax=0;
function same(before,after,label){for(const key of Object.keys(before))for(let i=0;i<4;i++){observedMax=Math.max(observedMax,Math.abs(before[key][i]-after[key][i]));assert(Math.abs(before[key][i]-after[key][i])<=1,label+' moved '+key+': '+JSON.stringify({before,after}));}}
async function shot(name){const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(output+'/'+name+'.png',Buffer.from(r.data,'base64'));}
async function reloadFixture(key='fixed-ui-start'){
 await evaluate(`localStorage.setItem('three_kingdoms.run.mobile_v2.save',sessionStorage.getItem(${JSON.stringify(key)}));`);
 await call('Page.reload');await delay(500);await wait('.v2-main-menu');await click('继续远征');await wait('.v2-battle-fixed');
}
try{
 await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:'http://127.0.0.1:5178'});await delay(600);await wait('.v2-main-menu');
 await evaluate(`(async()=>{const{createRun,act}=await import('/src/v2/engine.ts');const{DECKS,CARDS}=await import('/src/v2/data.ts');const{serializeRun}=await import('/src/v2/persistence.ts');let s=createRun(DECKS[0].id,DECKS[0].leaders[0],'fixed-ui-browser');localStorage.clear();localStorage.setItem('five-arrays-v2-onboarding-choice','declined');sessionStorage.setItem('fixed-ui-start',serializeRun(s));
 let t=createRun(DECKS[0].id,DECKS[0].leaders[0],'fixed-ui-targets');t.leaderId=null;const names=['庞统','筹措军粮','擂鼓进军','孙尚香','环首刀'];for(let i=0;i<names.length;i++)t.cards[t.battle.hand[i]].definitionId=CARDS.find(c=>c.name===names[i]).id;const ids=[...t.battle.hand];for(const[slot,i]of [[0,0],[1,1],[2,2],[3,3]]){const r=act(t,{type:'stage',cardId:ids[i],slot});if(!r.ok)throw Error(r.error);t=r.state;}sessionStorage.setItem('fixed-ui-targets',serializeRun(t));})()`);
 for(const[width,height]of [[1280,720],[1440,900],[1920,1080],[360,640],[390,844]]){
  observedMax=0;
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await reloadFixture();
  const before=await bounds();
  const hierarchy=await evaluate(`(()=>{const preview=document.querySelector('.v2-preview').getBoundingClientRect(),slot=document.querySelector('.v2-slot').getBoundingClientRect(),bar=document.querySelector('.v2-hp-track').getBoundingClientRect(),intel=document.querySelector('.v2-boss-intel');return{above:preview.bottom<=slot.top,barHeight:bar.height,intelVisible:intel.getBoundingClientRect().height>40,rule:intel.innerText};})()`);
  assert(hierarchy.above&&hierarchy.barHeight>=24&&hierarchy.intelVisible&&hierarchy.rule.includes('中军铁壁'),'New information hierarchy invalid '+JSON.stringify(hierarchy));
  await click('总览');await wait('[aria-label="职业与兵器增幅加成"]');same(before,await bounds(),width+' overview');
  assert(await evaluate(`(()=>{const b=document.querySelector('[aria-label="打开设置"]'),r=b.getBoundingClientRect();return !document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).closest('.v2-topbar')})()`),'Topbar intercepted overview');await shot(width+'-overview');await click('关闭');

  const dragPoints=await evaluate(`(()=>{const a=document.querySelector('.v2-hand-card').getBoundingClientRect(),b=document.querySelector('[data-v2-slot="2"]').getBoundingClientRect();return{from:{x:a.x+a.width/2,y:a.y+a.height/2},to:{x:b.x+b.width/2,y:b.y+b.height/2},width:a.width,height:a.height,id:document.querySelector('.v2-hand-card').dataset.dragCardId};})()`);
  const touch=width<700;
  if(touch){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dragPoints.from]});await delay(350);}
  else {await call('Input.dispatchMouseEvent',{type:'mouseMoved',...dragPoints.from});await call('Input.dispatchMouseEvent',{type:'mousePressed',...dragPoints.from,button:'left',buttons:1,clickCount:1});}
  for(let n=1;n<=8;n++){const x=dragPoints.from.x+(dragPoints.to.x-dragPoints.from.x)*n/8,y=dragPoints.from.y+(dragPoints.to.y-dragPoints.from.y)*n/8;await call(touch?'Input.dispatchTouchEvent':'Input.dispatchMouseEvent',touch?{type:'touchMove',touchPoints:[{x,y}]}:{type:'mouseMoved',x,y,button:'left',buttons:1});await delay(25);}
  const ghost=await evaluate(`(()=>{const r=document.querySelector('.v2-drag-ghost')?.getBoundingClientRect();return r?{width:r.width,height:r.height}:null;})()`);
  assert(ghost&&Math.abs(ghost.width-dragPoints.width)<1&&Math.abs(ghost.height-dragPoints.height)<1,'Drag ghost changed card dimensions');
  await call(touch?'Input.dispatchTouchEvent':'Input.dispatchMouseEvent',touch?{type:'touchEnd',touchPoints:[]}:{type:'mouseReleased',...dragPoints.to,button:'left',buttons:0,clickCount:1});await delay(500);
  assert(await evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save')).battle.slots[2]`)===dragPoints.id,'Pointer drag did not stage card');same(before,await bounds(),width+' actual drag');await click('全部撤回');
  const beforeSeats=await evaluate(`[...document.querySelectorAll('[data-hand-anchor]')].map(e=>[e.getBoundingClientRect().x,e.getBoundingClientRect().y])`);
  for(let i=0;i<5;i++){
   await evaluate(`document.querySelector('[data-testid="v2-hand-card"]').click()`);await delay(50);
   await evaluate(`document.querySelector('[data-v2-slot="${i}"]').click()`);await delay(70);
   same(before,await bounds(),width+' stage '+(i+1));
   const actual=await evaluate(`({hand:document.querySelectorAll('[data-testid="v2-hand-card"]').length,anchors:document.querySelectorAll('[data-hand-anchor]').length,seats:[...document.querySelectorAll('[data-hand-anchor]')].map(e=>[e.getBoundingClientRect().x,e.getBoundingClientRect().y])})`);
   assert(actual.hand===7-i&&actual.anchors===8,'Incorrect real hand or display seats');assert(JSON.stringify(actual.seats)===JSON.stringify(beforeSeats),'Hand seats moved');
  }
  await shot(width+'-staged');
  const valid=await evaluate(`(()=>{const c=document.querySelector('.v2-hand-card').getBoundingClientRect(),s=document.querySelector('.v2-slot').getBoundingClientRect(),f=document.querySelector('.v2-formation-scroll').getBoundingClientRect(),h=document.querySelector('.v2-hand-scroll').getBoundingClientRect();return{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,cardEqual:Math.abs(c.width-s.width)<1&&Math.abs(c.height-s.height)<1,visible:s.top>=f.top&&s.bottom<=f.bottom+1&&c.top>=h.top&&c.bottom<=h.bottom+1};})()`);
  assert(valid.width<=width+1&&valid.height<=height+1&&valid.cardEqual&&valid.visible,'Viewport/cards invalid '+JSON.stringify({width,height,valid}));
  await click('全部撤回');same(before,await bounds(),width+' recall');
  await evaluate(`document.querySelector('[data-testid="v2-hand-card"]').click();`);await delay(60);await evaluate(`document.querySelector('[data-v2-slot="0"]').click();`);await delay(60);await click('出战破阵');same(before,await bounds(),width+' result');
  const hit=await evaluate(`({visible:!!document.querySelector('[aria-label="敌阵受击"]'),hp:Number(document.querySelector('[role="meter"]').getAttribute('aria-valuenow')),trail:parseFloat(document.querySelector('[data-testid="v2-hp-trail"]').style.width)})`);
  assert(hit.visible&&hit.hp<2400,'Committed hit feedback missing');await shot(width+'-hit');
  await click('查看本次效果');await wait('[role="dialog"]');same(before,await bounds(),width+' result dialog');await click('关闭');
  await reloadFixture('fixed-ui-targets');const targetBefore=await bounds();
  await evaluate(`document.querySelector('[aria-label="指定连环目标"]').click()`);await delay(60);same(targetBefore,await bounds(),width+' target prompt');
  await evaluate(`document.querySelector('[data-v2-slot="1"]').click()`);await delay(80);same(targetBefore,await bounds(),width+' mandatory target');
  await evaluate(`document.querySelector('[aria-label="发动弓腰姬，指定手牌兵器"]').click()`);await delay(60);
  await evaluate(`document.querySelector('.v2-hand-card.v2-skill-target').click()`);await delay(80);
  await evaluate(`document.querySelector('[aria-label="取消发动弓腰姬"]').click()`);await delay(80);same(targetBefore,await bounds(),width+' optional cancel');
  const noConsume=await evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save')).battle.hand.length===4`);assert(noConsume,'Preview consumed optional weapon');
  if(width<700){
   const left=await evaluate(`document.querySelector('.v2-hand-scroll').scrollLeft`);
   const rect=await evaluate(`(()=>{const r=document.querySelector('.v2-hand-scroll').getBoundingClientRect();return{x:r.x+r.width*.8,y:r.y+r.height*.5}})()`);
   await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x,y:rect.y}]});
   for(let j=1;j<=6;j++){await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x-j*20,y:rect.y}]});await delay(25);}
   await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(100);
   assert(await evaluate(`document.querySelector('.v2-hand-scroll').scrollLeft`)>left,'Touch hand row did not scroll');same(targetBefore,await bounds(),width+' horizontal touch');
  }
  const rawBefore=await evaluate(`localStorage.getItem('three_kingdoms.run.mobile_v2.save')`);
  const icon=await evaluate(`(()=>{const r=document.querySelector('.v2-skill-inspect').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  if(width<700){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[icon]});await delay(650);await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:icon.x,y:icon.y});
  await wait('.v2-skill-detail');same(targetBefore,await bounds(),width+' skill detail');
  assert(await evaluate(`localStorage.getItem('three_kingdoms.run.mobile_v2.save')`)===rawBefore,'Inspection changed state');
  assert(await evaluate(`document.documentElement.scrollHeight`)<=height+1,'Popup grew page');
  await shot(width+'-skill-detail');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await delay(60);
  await shot(width+'-targets');checks.push({width,height,placements:5,recall:true,result:true,target:true,optionalCancel:true,skillInspection:true,actualDrag:true,maxMovementPx:observedMax});
 }
 await evaluate(`(async()=>{
 const{createRun,act}=await import('/src/v2/engine.ts');const{DECKS,CARD_MAP}=await import('/src/v2/data.ts');const{serializeRun}=await import('/src/v2/persistence.ts');
 let state=createRun(DECKS[0].id,DECKS[0].leaders[0],'readability-boss-run');for(const card of Object.values(state.cards))card.permanentPower=100000;
 sessionStorage.setItem('readability-kill',serializeRun(state));const saved=new Set();
 for(let step=0;step<300&&state.phase!=='won';step++){
  if(state.phase==='battle'&&[5,11,17].includes(state.battleIndex)&&!saved.has(state.battleIndex)){sessionStorage.setItem('readability-boss-'+state.battleIndex,serializeRun(state));saved.add(state.battleIndex);}
  if(state.phase==='camp'&&state.battleIndex===4)sessionStorage.setItem('readability-before-boss',serializeRun(state));
  let action;
  if(state.phase==='battle'){
   const cardId=state.battle.hand.find(id=>CARD_MAP[state.cards[id].definitionId].type==='character');const staged=act(state,{type:'stage',cardId,slot:2});if(!staged.ok)throw Error(staged.error);state=staged.state;action={type:'play'};
  }else if(state.phase==='cardReward')action={type:'chooseCard',definitionId:state.reward.first?state.reward.candidates[0]:null};
  else if(state.phase==='enhanceReward')action={type:'chooseEnhancement',optionId:state.enhancements[0].id};
  else if(state.phase==='charmReward')action={type:'chooseCharmReward',optionId:(state.charmReward.candidates.find(c=>c.kind==='upgrade')||state.charmReward.candidates[0]).id};
  else if(state.phase==='market')action={type:'leaveMarket'};
  else if(state.phase==='camp')action={type:'nextBattle'};else throw Error(state.phase);
  const result=act(state,action);if(!result.ok)throw Error(result.error);state=result.state;
 }
 if(state.phase!=='won'||saved.size!==3)throw Error('Boss fixture traversal incomplete');
 })()`);
 for(const[width,height]of [[1440,900],[360,640]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});
  for(const index of [5,11,17]){
   await reloadFixture('readability-boss-'+index);const before=await bounds();
   const content=await evaluate(`(()=>{const panel=document.querySelector('.v2-boss-intel'),p=panel.querySelector('p'),range=document.createRange();range.selectNodeContents(p);return{state:panel.dataset.bossState,text:p.innerText,textBottom:range.getBoundingClientRect().bottom,panelBottom:panel.getBoundingClientRect().bottom}})()`);
   assert(content.textBottom<=content.panelBottom+1,'Boss full text clipped '+JSON.stringify({width,index,content}));
   if(index!==11){assert(content.state==='active','Boss expected penalty missing');await shot(width+'-boss-'+index+'-warning');}
   const ids=await evaluate(`(()=>{const s=JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save'));return [...document.querySelectorAll('.v2-hand-card')].filter(b=>b.querySelector('[data-card-type="character"]')).map(b=>b.dataset.dragCardId)})()`);
   async function stage(id,slot){await evaluate(`document.querySelector('.v2-hand-card[data-drag-card-id="${id}"]').click()`);await delay(50);await evaluate(`document.querySelector('[data-v2-slot="${slot}"]').click()`);await delay(60);}
   if(index===5)await stage(ids[0],2);
   if(index===11){await stage(ids[0],1);assert(await evaluate(`document.querySelector('.v2-boss-intel').dataset.bossState`)==='active','Occupied second slot not warned');await shot(width+'-boss-'+index+'-warning');await click('全部撤回');}
   if(index===17){await stage(ids[0],0);await stage(ids[1],4);}
   same(before,await bounds(),width+' boss condition '+index);
   assert(await evaluate(`document.querySelector('.v2-boss-intel').dataset.bossState`)==='avoided','Boss avoidance not displayed');await shot(width+'-boss-'+index+'-avoided');
  }
 }
 await evaluate(`localStorage.setItem('three_kingdoms.run.mobile_v2.save',sessionStorage.getItem('readability-before-boss'))`);await call('Page.reload');await delay(500);await wait('.v2-main-menu');await click('继续远征');await wait('.v2-camp');
 assert(await evaluate(`document.querySelector('[aria-label="首领战前情报"]').innerText.includes('中军铁壁')&&!document.querySelector('[aria-label="首领战前情报"] details')`),'Camp boss rule collapsed');await shot('360-before-boss');
 await reloadFixture('readability-kill');await evaluate(`document.querySelector('.v2-hand-card').click()`);await delay(50);await evaluate(`document.querySelector('[data-v2-slot="0"]').click()`);await delay(50);await click('出战破阵');await wait('[aria-label="破阵反馈"]');
 assert(await evaluate(`!!document.querySelector('.v2-route-page')&&getComputedStyle(document.querySelector('[aria-label="破阵反馈"]')).pointerEvents==='none'`),'Killing blow blocked phase transition');await shot('360-killing-blow');
 checks.push({behavior:'three bosses full warning and avoidance desktop/mobile, pre-boss camp, nonblocking killing blow',passed:true});
 await evaluate(`(async()=>{const{createRun}=await import('/src/v2/engine.ts');const{DECKS,CHARM_MAP}=await import('/src/v2/data.ts');const{serializeRun}=await import('/src/v2/persistence.ts');const s=createRun(DECKS[0].id,DECKS[0].leaders[0],'three-charm-layout');for(const[index,suffix]of [[1,'shuang_feng_jun_yin'],[2,'cheng_shi_jing']]){const definitionId='three_kingdoms.charm.'+suffix;s.charms[index]={id:'charm-'+s.nextId++,definitionId,acquiredPrice:CHARM_MAP[definitionId].price,tier:1};}sessionStorage.setItem('readability-three-charms',serializeRun(s));})()`);
 for(const[width,height]of [[1280,720],[1024,768],[360,640]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await reloadFixture('readability-three-charms');
  const charms=await evaluate(`(()=>{return [...document.querySelectorAll('.v2-command-bar .v2-charm-slot')].map(slot=>{const r=slot.getBoundingClientRect(),button=slot.querySelector('.v2-charm-info'),b=button.getBoundingClientRect(),label=button.querySelector('span:not(.v2-charm-art)'),text=label.getBoundingClientRect();return{minTouch:b.width>=44-1&&b.height>=44,buttonFits:b.right<=r.right+1&&b.left>=r.left-1,textFits:!text.width||text.right<=b.right+1}})})()`);
  assert(charms.length===3&&charms.every(c=>c.minTouch&&c.buttonFits&&c.textFits),'Occupied charm row overlaps '+JSON.stringify({width,charms}));await shot(width+'-three-charms');
 }
 checks.push({behavior:'three occupied charm slots fit at 1280/1024/360 with tier badges and touch targets',passed:true});
 await fs.writeFile(output+'/verification.json',JSON.stringify({checkedAt:new Date().toISOString(),checks},null,2));
 console.log(JSON.stringify(checks,null,2));
}finally{ws.close();}
