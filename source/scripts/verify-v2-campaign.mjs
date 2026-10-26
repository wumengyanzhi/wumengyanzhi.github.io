import fs from 'node:fs/promises';
const origin = 'http://127.0.0.1:5178';
const pages = await (await fetch('http://127.0.0.1:9458/json/list')).json();
const page = pages.find(item => item.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result); }
  else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const wait = async selector => {
  for (let i = 0; i < 100; i++) { if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Not rendered: ${selector}: ${await evaluate('document.body.innerText.slice(0,1200)')}`);
};
const click = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.innerText.includes(${JSON.stringify(text)})||b.getAttribute("aria-label")?.includes(${JSON.stringify(text)})));if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click();return true;})()`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const outputDir = 'docs/完整游戏/截图/随机强化';
const checks = [];
async function screenshot(name, width, height) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  await new Promise(resolve => setTimeout(resolve, 250));
  const dimensions = await evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,height:innerHeight})');
  assert(dimensions.documentWidth <= width + 1 && dimensions.bodyWidth <= width + 1, `Horizontal overflow ${name}: ${JSON.stringify(dimensions)}`);
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(`${outputDir}/${name}.png`, Buffer.from(shot.data, 'base64'));
  checks.push({ screen: name, ...dimensions, noHorizontalOverflow: true });
}

const readSave=()=>evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save'))`);
async function loadFixture(phase,index){
  await evaluate(`localStorage.setItem('three_kingdoms.run.mobile_v2.save',window.__campaignFixtures[${JSON.stringify(phase+':'+index)}]);`);
  await call('Page.reload');await new Promise(r=>setTimeout(r,500));await wait('.v2-main-menu');await click('继续远征');await wait(phase==='battle'?'.v2-battle':'.v2-route-page');
}
try {
  await fs.mkdir(outputDir,{recursive:true});await call('Runtime.enable');await call('Page.enable');
  await call('Page.navigate',{url:origin});await new Promise(r=>setTimeout(r,500));await wait('.v2-main-menu');
  await evaluate(`localStorage.clear();localStorage.setItem('five-arrays-v2-onboarding-choice','declined');`);
  await call('Page.reload');await new Promise(r=>setTimeout(r,500));await wait('.v2-main-menu');await click('踏上征途');await wait('.v2-new-run');await click('确认出征');await wait('.v2-battle');
  let state=await readSave();assert(state.contentVersion==='mobile-v2-campaign-2026-10-20'&&state.battle.maxHp===2400,'New campaign not selected');
  await screenshot('01-opening-phone',360,640);await screenshot('02-opening-desktop',1280,800);
  await evaluate(`document.querySelector('[data-testid="v2-hand-card"]').click();`);
  await new Promise(r=>setTimeout(r,100));
  await evaluate(`document.querySelector('[data-testid="v2-slot"]').click();`);
  await new Promise(r=>setTimeout(r,100));
  await click('出战破阵');await new Promise(r=>setTimeout(r,120));
  state=await readSave();assert(state.battle.completedPlays===1,'Real play failed');
  const before=JSON.stringify(state);await call('Page.reload');await new Promise(r=>setTimeout(r,500));await wait('.v2-main-menu');await click('继续远征');await wait('.v2-battle');assert(JSON.stringify(await readSave())===before,'Resume modified state');
  checks.push({behavior:'new campaign, actual play and reload resume',passed:true});
  // Boosted fixtures verify reachability/UI only. Balance experiments use unchanged real runs.
  await evaluate(`(async()=>{
    const {createRun,act}=await import('/src/v2/engine.ts');const {DECKS,CARD_MAP}=await import('/src/v2/data.ts');const {serializeRun}=await import('/src/v2/persistence.ts');
    let s=createRun(DECKS[0].id,DECKS[0].leaders[0],'browser-all-phases');for(const c of Object.values(s.cards))c.permanentPower=100000;
    const snapshots={};const save=()=>{const key=s.phase+':'+s.battleIndex;if(!snapshots[key])snapshots[key]=serializeRun(s);};
    const commit=a=>{const r=act(s,a);if(!r.ok)throw Error(r.error);s=r.state;save();};save();
    for(let n=0;n<300&&s.phase!=='won';n++){
      if(s.phase==='battle'){const cardId=s.battle.hand.find(id=>CARD_MAP[s.cards[id].definitionId].type==='character');commit({type:'stage',cardId,slot:2});commit({type:'play'});}
      else if(s.phase==='cardReward')commit({type:'chooseCard',definitionId:s.reward.first?s.reward.candidates[0]:null});
      else if(s.phase==='enhanceReward')commit({type:'chooseEnhancement',optionId:s.enhancements[0].id,cardId:s.enhancements[0].targetId});
      else if(s.phase==='charmReward'){const o=s.charmReward.candidates.find(o=>o.kind==='upgrade')||s.charmReward.candidates[0];commit({type:'chooseCharmReward',optionId:o.id});}
      else if(s.phase==='market')commit({type:'leaveMarket'});
      else if(s.phase==='camp')commit({type:'nextBattle'});else throw Error(s.phase);
    }
    if(s.phase!=='won')throw Error('18 battle fixture not complete');sessionStorage.setItem('campaign-ui-fixtures',JSON.stringify(snapshots));window.__campaignFixtures=snapshots;
  })()`);
  // Persist fixtures in session storage because each screen resumes via a fresh application load.
  const fixtures=await evaluate(`sessionStorage.getItem('campaign-ui-fixtures')`);
  async function show(phase,index){await evaluate(`window.__campaignFixtures=JSON.parse(sessionStorage.getItem('campaign-ui-fixtures'));`);await loadFixture(phase,index);}
  assert(Object.keys(JSON.parse(fixtures)).length>60,'Fixtures missing phases');
  await show('cardReward',0);await screenshot('01-legendary-phone',360,640);await click('收入牌组');await wait('.v2-enhancement-reroll');
  assert(await evaluate(`document.querySelectorAll('.v2-reward-card').length===3&&!document.querySelector('.v2-route-page select')`),'Random choices still allow target selection');
  await screenshot('02-random-enhancement-phone',360,640);await screenshot('03-random-enhancement-desktop',1280,800);
  const initial=await readSave();await click('重抽三项');state=await readSave();
  assert(state.gold===initial.gold-2&&state.enhancementRerolls===1&&JSON.stringify(state.cards)===JSON.stringify(initial.cards),'First reroll cost or mutation wrong');
  assert(JSON.stringify(state.enhancements.map(o=>o.targetId).sort())!==JSON.stringify(initial.enhancements.map(o=>o.targetId).sort()),'Reroll did not change any target');
  const rolled=JSON.stringify(state);await call('Page.reload');await new Promise(r=>setTimeout(r,500));await wait('.v2-main-menu');await click('继续远征');await wait('.v2-enhancement-reroll');
  assert(JSON.stringify(await readSave())===rolled,'Reload changed candidates or reroll fee');
  await click('重抽三项');state=await readSave();assert(state.gold===initial.gold-5&&state.enhancementRerolls===2,'Second reroll must cost 3 gold');
  await screenshot('04-paid-reroll-desktop',1280,800);
  const option=state.enhancements[0],target=option.targetId,field=option.stat==='power'?'permanentPower':'permanentAmp',old=state.cards[target][field];
  await click('确认强化');state=await readSave();assert(state.phase==='camp'&&state.cards[target][field]===old+option.amount,'Fixed target enhancement wrong');
  await screenshot('05-camp-phone',360,640);checks.push({behavior:'three fixed random choices, paid 2/3 gold rerolls, reload lock and fixed-target claim',passed:true});
  const oldReward=await fs.readFile('src/tests/fixtures/campaign-v040-enhancement.json','utf8');
  await evaluate(`localStorage.setItem('three_kingdoms.run.mobile_v2.save',${JSON.stringify(oldReward)});`);
  await call('Page.reload');await new Promise(r=>setTimeout(r,500));await wait('.v2-main-menu');await click('继续远征');await wait('.v2-enhancement-reroll');
  assert(await evaluate(`!document.querySelector('.v2-route-page select')&&document.querySelectorAll('.v2-reward-card').length===3`),'Old enhancement screen did not migrate');
  await screenshot('06-old-save-migration-phone',360,640);await click('确认强化');state=await readSave();
  assert(state.phase==='camp'&&state.gold===JSON.parse(oldReward).gold,'Migrated claim lost reward or charged gold');checks.push({behavior:'actual v0.4.0 reward save migrates and continues without a charge',passed:true});
  await show('charmReward',2);await screenshot('07-route-choice-phone',360,640);await click('选择获得');await wait('[role="dialog"]');
  const raw=JSON.stringify(await readSave());await screenshot('08-charm-confirm-phone',360,640);await click('取消选择');assert(JSON.stringify(await readSave())===raw,'Cancelled reward changed state');
  await show('charmReward',5);await screenshot('09-boss-reward-phone',360,640);await click('选择升阶');await wait('[role="dialog"]');await click('确认领取');
  state=await readSave();assert(state.phase==='camp'&&state.baseAmp===4&&state.charms.some(c=>c&&c.tier===2),'Boss reward wrong');checks.push({behavior:'reward cancel unchanged and atomic boss upgrade plus base amp',passed:true});
  await show('market',7);await screenshot('10-market-phone',360,640);state=await readSave();const gold=state.gold;
  await click('选择升阶');await wait('[role="dialog"]');await screenshot('11-upgrade-phone',360,640);await click('确认升阶');
  state=await readSave();assert(state.market.upgraded&&state.gold===gold-4,'Market upgrade cost/limit wrong');checks.push({behavior:'unlocked market tier upgrade and payment',passed:true});
  for(const index of [5,11,17]){await show('battle',index);await screenshot('12-boss-'+index+'-phone',360,640);}
  await show('won',17);await screenshot('13-final-victory-phone',360,640);checks.push({behavior:'three boss screens and eighteen-battle terminal',passed:true});
  await evaluate(`(async()=>{const {createLegacyRun}=await import('/src/v2/engine.ts');const {DECKS}=await import('/src/v2/data.ts');const {serializeRun}=await import('/src/v2/persistence.ts');localStorage.setItem('three_kingdoms.run.mobile_v2.save',serializeRun(createLegacyRun(DECKS[0].id,DECKS[0].leaders[0],'legacy-browser')));})()`);
  await call('Page.reload');await new Promise(r=>setTimeout(r,500));await wait('.v2-main-menu');await click('继续远征');await wait('.v2-battle');
  assert(await evaluate(`document.querySelector('nav[aria-label="六战行程"]')!==null`),'Legacy progress changed');await screenshot('14-legacy-phone',360,640);checks.push({behavior:'old six-battle save retains old presentation',passed:true});
  assert(!errors.length,'Browser exceptions: '+errors.join('\n'));
  await fs.writeFile('artifacts/v2/2026-10-20-random-enhancement-browser.json',JSON.stringify({origin,fixtureNote:'Boosted fixture cards are only for UI reachability, not balance evidence.',checks,errors},null,2));
  console.log(JSON.stringify({checks:checks.length,errors}));
}finally{ws.close();}
