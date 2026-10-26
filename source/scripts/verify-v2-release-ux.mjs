import fs from 'node:fs/promises';
const origin = process.env.GAME_URL ?? 'http://127.0.0.1:5178/';
const pages = await (await fetch('http://127.0.0.1:9460/json/list')).json();
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let next = 0;
const pending = new Map(), checks = [], errors = [];
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); ws.send(JSON.stringify({ id, method, params })); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const assert = (value, message) => { if (!value) throw new Error(message); };
const wait = async selector => { for (let i = 0; i < 120; i++) { if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return; await delay(70); } throw new Error('Missing: ' + selector); };
const saved = () => evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save'))`);
const hand = id => `[data-testid="v2-hand-card"][data-drag-card-id="${id}"]`;
const slot = index => `[data-testid="v2-slot"][data-v2-slot="${index}"]`;
async function center(selector) { return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); }
const mouse = (type, point, pressed = false) => call('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
const touch = (type, point) => call('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1, radiusX: 2, radiusY: 2, force: 1 }] : [] });
async function click(selector, phone = false) {
  await center(selector); await delay(120); const point = await center(selector);
  assert(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),top=document.elementFromPoint(${point.x},${point.y});return e===top||e.contains(top)})()`), 'Click target covered: ' + selector);
  if (phone) { await touch('touchStart', point); await delay(30); await touch('touchEnd'); }
  else { await mouse('mouseMoved', point); await mouse('mousePressed', point, true); await mouse('mouseReleased', point); }
  await delay(130);
}
async function doubleClick(selector) {
  await center(selector); await delay(120); const point = await center(selector);
  for (const count of [1, 2]) {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: count });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: count });
    await delay(40);
  }
  await delay(130);
}
async function fixture(slots, names, handSize = 8) {
  await evaluate(`(async()=>{const {createRun}=await import('/src/v2/engine.ts');const {DECKS,CARDS}=await import('/src/v2/data.ts');const {serializeRun,SAVE_KEY}=await import('/src/v2/persistence.ts');const s=createRun(DECKS[0].id,DECKS[0].leaders[0],'release-ux');s.leaderId=null;let i=0;const assign=name=>{const id=s.owned[i++];s.cards[id].definitionId=CARDS.find(c=>c.name===name).id;return id};s.battle.slots=Array.from({length:5},(_,n)=>${JSON.stringify(slots)}[n]?assign(${JSON.stringify(slots)}[n]):null);const h=${JSON.stringify(names)}.map(assign);s.battle.hand=[...h,...s.owned.slice(i,i+8-h.length)];s.battle.draw=s.owned.filter(id=>!s.battle.hand.includes(id)&&!s.battle.slots.includes(id));s.battle.discard=[];localStorage.setItem(SAVE_KEY,serializeRun(s));localStorage.setItem('five-arrays-v2-onboarding-choice','declined');})()`);
  if (handSize < 8) await evaluate(`(()=>{const key='three_kingdoms.run.mobile_v2.save',s=JSON.parse(localStorage.getItem(key));s.battle.draw.push(...s.battle.hand.splice(${handSize}));localStorage.setItem(key,JSON.stringify(s));})()`);
  await call('Page.reload'); await wait('.v2-main-menu'); await click('.v2-menu-actions .v2-primary'); await wait('.v2-battle');
  await evaluate('scrollTo(0,0)'); await delay(250); return saved();
}
async function shot(name) { const r = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await fs.writeFile(`docs/完整游戏/截图/${name}.png`, Buffer.from(r.data, 'base64')); }
async function layout() {
  const geometry = await evaluate(`(()=>{const faces=[...document.querySelectorAll('.v2-hand-card .v2-card-face,.v2-slot .v2-card-face')];return {width:innerWidth,page:document.documentElement.scrollWidth,cards:faces.map(face=>{const r=face.getBoundingClientRect(),title=face.querySelector('.v2-card-title'),stats=face.querySelector('.v2-card-stats'),name=title.querySelector('.v2-card-name').getBoundingClientRect(),sub=title.querySelector('small')?.getBoundingClientRect();return{width:r.width,height:r.height,titleOver:title.scrollWidth>title.clientWidth+1,statsOver:stats.scrollWidth>stats.clientWidth+1,sameLine:!sub||Math.abs(name.bottom-sub.bottom)<10,art:face.querySelector('.v2-card-art').getBoundingClientRect().height,skills:face.querySelector('.v2-card-skills')?.textContent}})}})()`);
  assert(geometry.page <= geometry.width + 1, 'Page overflows horizontally');
  for (const card of geometry.cards) {
    assert(Math.abs(card.height / card.width - 10 / 7) < .015, 'Card ratio changed: ' + JSON.stringify(card));
    assert(!card.titleOver && !card.statsOver && card.sameLine, 'Card text overflows: ' + JSON.stringify(card));
    assert(card.art > 15, 'Artwork squeezed away');
  }
  return geometry;
}
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin }); await wait('.v2-app');
  let s = await fixture([], ['夏侯惇', '环首刀', '长柄铁枪', '魏营宿卫', '筹措军粮']);
  const hero = s.battle.hand[0], weapon = s.battle.hand[1];
  await click(hand(hero));
  assert(await evaluate(`document.querySelector(${JSON.stringify(hand(weapon))}).innerText.includes('本职 · 增幅 +4')`), 'No weapon pairing recommendation');
  await shot('43-release-pairing-desktop');
  await click(slot(0)); await click(hand(weapon)); await click(slot(1));
  assert(await evaluate(`!document.querySelector('.v2-choices select')&&document.querySelector(${JSON.stringify(slot(1))}).innerText.includes('装备：夏侯惇')`), 'Automatic owner missing');
  assert(await evaluate(`document.querySelector('[aria-label="本次技能"]').innerText.includes('将触发')&&!document.querySelector('.v2-play').disabled`), 'Automatic skill still blocks battle');
  await layout(); await evaluate('scrollTo(0,0)'); await shot('44-release-skills-desktop');
  await center('[data-testid="v2-hand-card"]'); await delay(250);
  await mouse('mouseMoved', {x:1430,y:20}); await delay(100);
  const point = await center('[data-testid="v2-hand-card"]'); await mouse('mouseMoved', point); await delay(1000);
  assert(!await evaluate(`!!document.querySelector('[role="tooltip"]')`), 'Hover appears before 1.5 seconds');
  await delay(650); await wait('[role="tooltip"]'); await mouse('mouseMoved', {x:1430,y:980}); await delay(200);
  checks.push('桌面：牌面推荐、实际装备、自动砺兵、无需下拉框、悬停延迟');
  s = await fixture(['庞统', '筹措军粮', '擂鼓进军'], ['环首刀'], 5);
  await click('[aria-label="指定连环目标"]'); await doubleClick(slot(0));
  assert(JSON.stringify((await saved()).battle.slots) === JSON.stringify(s.battle.slots), 'Invalid target double click unstages character');
  await doubleClick(slot(2));
  assert(JSON.stringify((await saved()).battle.slots) === JSON.stringify(s.battle.slots) && (await saved()).battle.targets['skill:' + s.battle.slots[0]] === s.battle.slots[2], 'Target double click also unstages tactic');
  s = await fixture(['孙尚香'], ['环首刀'], 5);
  await click('[aria-label="发动弓腰姬，指定手牌兵器"]'); await doubleClick(hand(s.battle.hand[0]));
  assert(JSON.stringify((await saved()).battle.slots) === JSON.stringify(s.battle.slots) && (await saved()).battle.targets['skill:' + s.battle.slots[0]] === s.battle.hand[0], 'Target double click also stages weapon');
  checks.push('桌面原生双击：有效手牌/阵中目标与无效人物均不会误触布阵');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  s = await fixture(['夏侯惇', '环首刀'], ['军师羽扇', '并锋斩马刀', '魏营宿卫', '筹措军粮']);
  await layout(); await evaluate('scrollTo(0,0)'); await shot('45-release-phone-battle');
  await click('[aria-label="展开技能说明"]', true);
  assert(await evaluate(`!!document.querySelector('.v2-skills-expanded')`), 'Cannot expand mobile skill details');
  await click('[aria-label="收起技能说明"]', true);
  await click(hand(s.battle.hand[0]), true); await shot('46-release-phone-pairing');
  const target = await center(hand(s.battle.hand[0])); await touch('touchStart', target); await delay(380); await touch('touchEnd'); await wait('[role="tooltip"]'); await shot('47-release-phone-details');
  await touch('touchStart', {x:15,y:15}); await touch('touchEnd'); await delay(150);
  await click('.v2-play', true);
  assert(await evaluate(`document.querySelector('[aria-label="本次出战结果"]').innerText.includes('本局永久威力 +10')`), 'Actual skill effect missing');
  await center('[aria-label="本次出战结果"]'); await shot('50-release-phone-result');
  s = await fixture(['庞统', '筹措军粮', '擂鼓进军'], ['环首刀']);
  await click('[aria-label="指定连环目标"]', true); await click(slot(2), true);
  assert((await saved()).battle.targets['skill:' + s.battle.slots[0]] === s.battle.slots[2], 'Touch card target did not commit');
  await evaluate('scrollTo(0,0)'); await shot('48-release-direct-skill-target');
  s = await fixture(['孙尚香'], ['环首刀']); const beforeHand = s.battle.hand;
  await click('[aria-label="发动弓腰姬，指定手牌兵器"]', true); await click(hand(beforeHand[0]), true);
  assert(JSON.stringify((await saved()).battle.hand) === JSON.stringify(beforeHand), 'Choosing consumed a weapon early');
  await click('[aria-label="取消发动弓腰姬"]', true);
  assert((await saved()).battle.targets['skill:' + s.battle.slots[0]] === '', 'Cannot cancel optional consumption');
  checks.push('390px触屏：同尺寸牌、长按详情、直接点战术指定、可选兵器消耗与取消');
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
  await fixture(['夏侯惇', '环首刀'], ['并锋斩马刀', '军师羽扇', '魏营宿卫', '筹措军粮']);
  await layout(); await evaluate('scrollTo(0,0)'); await shot('49-release-small-phone');
  checks.push('320px短屏：姓名职业同行、威力增幅完整、无横向溢出、7:10牌面');
  assert(errors.length === 0, errors.join('\n'));
  await fs.writeFile('artifacts/v2/release-interaction-browser.json', JSON.stringify({ ok: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, errors }, null, 2));
} finally { ws.close(); }
