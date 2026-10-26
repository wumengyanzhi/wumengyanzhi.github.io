import fs from 'node:fs/promises';

// Run against a disposable Chrome profile: this resets only that profile's game data.
const pages = await (await fetch('http://127.0.0.1:9460/json/list')).json();
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let next = 0;
const pending = new Map(), errors = [], checks = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const item = pending.get(message.id); pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const assert = (value, message) => { if (!value) throw new Error(message); };
const click = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(${JSON.stringify(text)}));if(!b)throw Error('Missing button');b.click();})()`);
const wait = async selector => { for (let i = 0; i < 100; i++) { if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return; await delay(50); } throw new Error(`Missing ${selector}`); };
const saved = () => evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save'))`);
const center = (selector, index = 0) => evaluate(`(()=>{const r=document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
const hand = '[data-testid="v2-hand-card"]', slot = '[data-testid="v2-slot"]';
async function fresh() {
  await evaluate(`(async()=>{const {createRun}=await import('/src/v2/engine.ts');const {DECKS}=await import('/src/v2/data.ts');const {SAVE_KEY,serializeRun}=await import('/src/v2/persistence.ts');localStorage.setItem(SAVE_KEY,serializeRun(createRun(DECKS[0].id,DECKS[0].leaders[0],'card-layout-qa')));})()`);
  await call('Page.reload'); await delay(180); await wait('.v2-main-menu'); await click('继续远征'); await wait('.v2-battle');
}
const cardGeometry = selector => evaluate(`(()=>{const face=document.querySelector(${JSON.stringify(selector)}),r=face.getBoundingClientRect(),art=face.querySelector('.v2-card-art').getBoundingClientRect();return {width:r.width,height:r.height,artWidth:art.width,artHeight:art.height,font:getComputedStyle(face.querySelector('strong')).fontSize,compact:face.classList.contains('v2-card-compact'),type:face.querySelector('.v2-card-top').innerText,profession:face.querySelector('small')?.innerText}})()`);
async function screenshot(name) {
  const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(`docs/完整游戏/截图/${name}.png`, Buffer.from(result.data, 'base64'));
}
async function touch(type, point) { await call('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1, radiusX: 2, radiusY: 2, force: 1 }] : [] }); }
async function touchDrag(from, to) {
  await touch('touchStart', from); await delay(340);
  const initial = { x: from.x + (to.x - from.x) / 8, y: from.y + (to.y - from.y) / 8 };
  await touch('touchMove', initial); await delay(30);
  const ghost = await cardGeometry('[data-testid="v2-drag-ghost"] .v2-card-face');
  for (let i = 1; i <= 8; i++) { await touch('touchMove', { x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }); await delay(16); }
  await touch('touchEnd'); await delay(80); return ghost;
}

const mouse = (type, point, pressed = false) => call('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
const tip = '[role="tooltip"]';
const assertPanel = async () => assert(await evaluate(`(()=>{const r=document.querySelector('[role="tooltip"]')?.getBoundingClientRect();return r&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`), 'Introduction overflows viewport');
const assertBadges = async () => {
  const clipped = await evaluate(`Array.from(document.querySelectorAll('.v2-card-face')).filter(face=>{const f=face.getBoundingClientRect(),t=face.querySelector('.v2-card-type').getBoundingClientRect(),r=face.querySelector('.v2-card-rarity').getBoundingClientRect();return t.right>r.left+1||r.right>f.right-1||t.left<f.left+1}).map(f=>({name:f.dataset.cardDefinition,width:f.getBoundingClientRect().width}))`);
  assert(clipped.length===0,'Clipped type/rarity: '+JSON.stringify(clipped));
};
try {
  await call('Runtime.enable'); errors.length=0; await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:5178/'});await wait('.v2-main-menu');await evaluate('localStorage.clear()');await fresh();
  let before=await saved();
  await evaluate(`document.querySelector('[data-testid="v2-hand-card"]').scrollIntoView({block:'center'})`);await delay(120);
  const from=await center(hand);await mouse('mouseMoved',from);await delay(230);await wait(tip);await assertPanel();
  const definition=await evaluate(`document.querySelector('[data-testid="v2-hand-card"] .v2-card-face').dataset.cardDefinition`);
  assert(await evaluate(`(async()=>{const{CARD_MAP}=await import('/src/v2/data.ts');return document.querySelector('[role="tooltip"]').innerText.includes(CARD_MAP[${JSON.stringify(definition)}].text)})()`),'Mouse introduction rule missing');
  assert(JSON.stringify(await saved())===JSON.stringify(before),'Hover changed save');
  await screenshot('26-card-hover-desktop');
  await mouse('mouseMoved',await center(tip));await delay(250);assert(await evaluate(`!!document.querySelector('[role="tooltip"]')`),'Moving into introduction closed it');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await delay(60);
  assert(await evaluate(`!document.querySelector('[role="tooltip"]')`),'Escape from an unfocused hover did not dismiss');
  await mouse('mouseMoved',from);await delay(230);
  await mouse('mousePressed',from,true);await mouse('mouseMoved',await center(slot),true);await delay(60);
  assert(await evaluate(`!!document.querySelector('[data-testid="v2-drag-ghost"]')&&!document.querySelector('[role="tooltip"]')`),'Mouse drag did not dismiss introduction');
  await mouse('mouseReleased',await center(slot));await delay(80);
  assert((await saved()).revision===before.revision+1,'Mouse drag changed command count');
  checks.push('mouse hover displays full live rule, accepts pointer, Escape dismisses and drag still commits once');
  await click('五阵');await wait('[role="dialog"]');await click('返回主菜单');await wait('.v2-main-menu');await click('万象图鉴');await wait('.v2-codex-grid');
  await assertBadges();
  const colors=await evaluate(`(()=>{const cards=[...document.querySelectorAll('.v2-card-face')];return {types:Object.fromEntries(cards.map(c=>[c.dataset.cardType,getComputedStyle(c.querySelector('.v2-card-top')).backgroundColor])),rarities:Object.fromEntries(cards.map(c=>[c.dataset.cardRarity,getComputedStyle(c).borderTopColor]))}})()`);
  assert(new Set(Object.values(colors.types)).size===3&&new Set(Object.values(colors.rarities)).size===4,'Type/rarity colors not distinct');
  await screenshot('27-card-rarity-codex');checks.push('all 60 codex cards: three type colors, four rarity colors, labels fit');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});await fresh();
  before=await saved();let point=await center(hand);
  await touch('touchStart',point);await delay(350);await wait(tip);await assertPanel();
  assert(await evaluate(`!document.querySelector('[data-testid="v2-drag-ghost"]')`),'Stationary phone hold started drag');
  await touch('touchEnd');await delay(100);
  assert(await evaluate(`!!document.querySelector('[role="tooltip"]')&&document.querySelector('[data-testid="v2-hand-card"]').getAttribute('aria-pressed')==='false'`),'Phone release closed details or selected card');
  assert(JSON.stringify(await saved())===JSON.stringify(before),'Phone inspection changed save');await screenshot('28-phone-long-press-details');
  await touch('touchStart',{x:200,y:145});await touch('touchEnd');await delay(80);
  assert(await evaluate(`!document.querySelector('[role="tooltip"]')`),'Outside phone tap did not dismiss');
  point=await center(hand);await touchDrag(point,await center(slot,1));
  assert((await saved()).battle.slots[1]===before.battle.hand[0]&&(await saved()).revision===before.revision+1,'Phone hold and move failed to drag exactly once');
  assert(await evaluate(`!document.querySelector('[role="tooltip"]')`),'Phone drag left stale introduction');
  await screenshot('29-card-types-mobile');checks.push('phone stationary hold reads details after release; outside tap dismisses; hold and move drags once');
  await call('Emulation.setDeviceMetricsOverride',{width:320,height:480,deviceScaleFactor:1,mobile:true});await fresh();
  await evaluate(`(async()=>{const{parseRun,serializeRun,SAVE_KEY}=await import('/src/v2/persistence.ts');const s=parseRun(localStorage.getItem(SAVE_KEY));s.cards[s.battle.hand[0]].enhancementSkills=['xian_deng','zhen_jun','tong_dao','gu_feng','jun_xu'];localStorage.setItem(SAVE_KEY,serializeRun(s));})()`);
  await call('Page.reload');await delay(180);await wait('.v2-main-menu');await click('继续远征');await wait('.v2-battle');
  await evaluate(`document.querySelector('[data-testid="v2-hand-card"]').scrollIntoView({block:'center'})`);await delay(100);
  point=await center(hand);await touch('touchStart',point);await delay(350);await touch('touchEnd');await delay(80);await wait(tip);await assertPanel();
  const scroll=await evaluate(`(()=>{const e=document.querySelector('[role="tooltip"]'),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom-60,overflow:e.scrollHeight>e.clientHeight}})()`);
  assert(scroll.overflow,'Long-content test did not overflow');
  await touch('touchStart',scroll);for(let i=1;i<=7;i++){await touch('touchMove',{x:scroll.x,y:scroll.y-190*i/7});await delay(16)}await touch('touchEnd');await delay(250);
  assert(await evaluate(`!!document.querySelector('[role="tooltip"]')&&document.querySelector('[role="tooltip"]').scrollTop>20`),'Scrolling long phone details dismissed or blocked it');
  await screenshot('30-phone-scrollable-details');
  await evaluate('window.scrollTo(0,0)');await delay(100);await click('总览');await wait('[role="dialog"]');await assertBadges();
  await screenshot('31-phone-card-overview');checks.push('320px long details scroll without closing; compact overview type and rarity labels remain visible');
  assert(errors.length===0,errors.join('\n'));
  await fs.writeFile('artifacts/v2/card-inspection-validation.json',JSON.stringify({checks,colors,errors},null,2));console.log(JSON.stringify({checks,colors,errors},null,2));
} finally { ws.close(); }
