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
const click = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(${JSON.stringify(text)}));if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click();return true;})()`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const outputDir = 'docs/完整游戏/截图';
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
async function loadFixture(phase, index) {
  const result = await evaluate(`(async()=>{
    const {DECKS}=await import('/src/v2/data.ts');const {createRun,act}=await import('/src/v2/engine.ts');
    const {simulateRun}=await import('/src/v2/simulation.ts');const {serializeRun,SAVE_KEY}=await import('/src/v2/persistence.ts');
    const deck=DECKS[0],record=simulateRun({deckId:deck.id,seed:'v2-independent-20261017:0',policy:'matching'});
    let s=createRun(deck.id,deck.leaders[1],record.seed);
    for(let i=0;i<record.commands.length;i++) {const result=act(s,record.commands[i],'auto-'+i);if(!result.ok)throw Error(result.error);s=result.state;if(s.phase===${JSON.stringify(phase)}&&s.battleIndex===${index})break;}
    if(s.phase!==${JSON.stringify(phase)}||s.battleIndex!==${index})throw Error('Fixture not reached');
    localStorage.setItem(SAVE_KEY,serializeRun(s));return {phase:s.phase,index:s.battleIndex,gold:s.gold,cards:s.owned.length};})()`);
  await call('Page.reload'); await wait('.v2-main-menu'); await click('继续远征'); await wait('.v2-route-page');
  return result;
}
try {
  await fs.mkdir(outputDir, { recursive: true });
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin }); await wait('.v2-main-menu');
  await evaluate('localStorage.clear()'); await call('Page.reload');
  await new Promise(resolve => setTimeout(resolve, 500)); await wait('.v2-main-menu');
  await evaluate(`new Promise(resolve=>{const image=new Image();image.onload=resolve;image.onerror=resolve;image.src='/art/campaign.png';})`);
  await screenshot('01-menu-desktop', 1440, 900);
  await screenshot('02-menu-mobile', 390, 844);
  await click('踏上征途'); await wait('.v2-new-run');
  await screenshot('03-deck-select-mobile', 360, 640);
  await click('确认出征'); await wait('.v2-battle');
  let state = await evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save'))`);
  assert(state.battle.hand.length === 8 && state.battle.slots.length === 5, 'Opening hand/slots wrong');
  await screenshot('04-battle-mobile-390', 390, 844);
  await screenshot('05-battle-mobile-360', 360, 640);
  await screenshot('06-battle-desktop', 1280, 720);
  await evaluate(`document.querySelector('[data-testid="v2-hand-card"]').click()`);
  await evaluate(`document.querySelector('[data-testid="v2-slot"]').click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(await evaluate(`document.querySelectorAll('[data-testid="v2-hand-card"]').length===7`), 'Tap placement failed');
  await click('出战破阵'); await new Promise(resolve => setTimeout(resolve, 150));
  state = await evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save'))`);
  assert(state.battle.completedPlays === 1 && state.battle.playsLeft === 3, 'Actual battle play failed');
  const saved = JSON.stringify(state);
  await call('Page.reload'); await wait('.v2-main-menu'); await click('继续远征'); await wait('.v2-battle');
  assert(await evaluate(`localStorage.getItem('three_kingdoms.run.mobile_v2.save')`) === saved, 'Reload changed saved state');
  checks.push({ behavior: 'tap placement, actual play, reload-resume', passed: true });
  const first = await loadFixture('cardReward', 0);
  assert(await evaluate(`document.querySelectorAll('.v2-reward-card').length===3&&!document.body.innerText.includes('跳过新卡')`), 'First reward not forced3');
  await screenshot('07-legendary-reward-mobile', 390, 844);
  await click('收入牌组'); await new Promise(resolve => setTimeout(resolve, 150));
  state = await evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save'))`);
  assert(state.phase === 'enhanceReward' && state.owned.length === first.cards + 1, 'Card then enhancement order wrong');
  await screenshot('08-enhancement-desktop', 1280, 720);
  await click('确认强化'); await new Promise(resolve => setTimeout(resolve, 100));
  assert(await evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save')).phase==='camp'`), 'Enhancement did not reach camp');
  await screenshot('09-camp-mobile', 360, 640);
  checks.push({ behavior: 'first forced legend then enhancement then camp', passed: true });
  const market = await loadFixture('market', 1);
  await screenshot('10-market-mobile', 390, 844);
  await click('选择槽位'); await wait('[role="dialog"]');
  await screenshot('11-trade-quote-mobile', 360, 640);
  await click('取消交易');
  assert(await evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save')).gold`) === market.gold, 'Cancel trade changed gold');
  await click('选择槽位'); await wait('[role="dialog"]');
  await click('确认购买'); await new Promise(resolve => setTimeout(resolve, 100));
  state = await evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save'))`);
  assert(state.charms.filter(Boolean).length === 2 && state.gold < market.gold, 'Charm purchase failed');
  await click('离开军市'); await new Promise(resolve => setTimeout(resolve, 100));
  assert(await evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save')).phase==='camp'`), 'Market leave failed');
  checks.push({ behavior: 'market quote, cancel, purchase, leave', passed: true });
  await loadFixture('won', 5); await screenshot('12-victory-mobile', 390, 844);
  await click('返回主菜单'); await wait('.v2-main-menu'); await click('万象图鉴'); await wait('.v2-codex-grid');
  assert(await evaluate(`document.querySelectorAll('.v2-codex-grid>button').length===60`), 'Codex missing content');
  await screenshot('13-codex-mobile', 360, 640);
  await evaluate(`document.querySelector('.v2-codex-grid > button').click()`); await wait('[role="dialog"]');
  const focus = await evaluate(`(()=>{const d=document.querySelector('[role="dialog"]');return !!d&&d.contains(document.activeElement)})()`);
  assert(focus, 'Modal focus is outside dialog');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(await evaluate(`!document.querySelector('[role="dialog"]')`), 'Escape did not close modal');
  checks.push({ behavior: 'victory/codex60/modal focus and Escape', passed: true });
  assert(errors.length === 0, `Browser exceptions: ${errors.join('\n')}`);
  await fs.writeFile('artifacts/v2/browser-validation.json', JSON.stringify({ origin, checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { ws.close(); }
