import fs from 'node:fs/promises';
const pages = await (await fetch('http://127.0.0.1:9460/json/list')).json();
const ws = new WebSocket(pages.find(item => item.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let next = 0;
const pending = new Map(), errors = [], checks = [];
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const wait = async selector => { for (let i = 0; i < 100; i++) { if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return; await delay(100); } throw new Error(`Missing ${selector}: ${await evaluate('document.body.innerText.slice(0,1200)')}`); };
const click = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(${JSON.stringify(text)}));if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.click();})()`);
const saved = () => evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.run.mobile_v2.save'))`);
const center = (selector, index = 0) => evaluate(`(()=>{const b=document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
const handCard = '[data-testid="v2-hand-card"]', slot = '[data-testid="v2-slot"]';
async function pointer(type, point, pressed, clickCount = 1) { await call('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : clickCount }); }
async function mouseDrag(from, to, release = true) {
  await pointer('mouseMoved', from, false); await pointer('mousePressed', from, true);
  for (let i = 1; i <= 7; i++) { await pointer('mouseMoved', { x: from.x + (to.x - from.x) * i / 7, y: from.y + (to.y - from.y) * i / 7 }, true); await delay(18); }
  if (release) { await pointer('mouseReleased', to, false); await delay(80); }
}
async function touch(type, point) { await call('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point.x, y: point.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] : [] }); }
async function screenshot(name) {
  if (process.argv.includes('--no-screenshots')) return;
  const size = await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');
  assert(size.scrollWidth <= size.width, `Overflow ${name}`);
  const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(`docs/完整游戏/截图/${name}.png`, Buffer.from(image.data, 'base64'));
}
async function fresh() {
  await evaluate(`(async()=>{const {createRun}=await import('/src/v2/engine.ts');const {DECKS}=await import('/src/v2/data.ts');const {SAVE_KEY,serializeRun}=await import('/src/v2/persistence.ts');localStorage.setItem(SAVE_KEY,serializeRun(createRun(DECKS[0].id,DECKS[0].leaders[0],'drag-browser-test')));})()`);
  await call('Page.reload'); await delay(350); await wait('.v2-main-menu'); await click('继续远征'); await wait('.v2-battle');
}
try {
  await call('Runtime.enable'); errors.length = 0; await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:5178' }); await delay(500); await wait('.v2-main-menu');
  await evaluate('localStorage.clear()'); await fresh();
  let before = await saved();
  const first = before.battle.hand[0], from = await center(handCard), to = await center(slot);
  await mouseDrag(from, to, false);
  assert(await evaluate(`!!document.querySelector('[data-testid="v2-drag-ghost"]')`), 'Mouse ghost not visible');
  assert((await saved()).revision === before.revision, 'Drag preview committed early');
  assert(await evaluate(`!!document.querySelector('.v2-drop-target')`), 'Drop target not highlighted');
  await screenshot('15-mouse-drag-preview');
  await pointer('mouseReleased', to, false); await delay(80);
  let after = await saved(); assert(after.battle.slots[0] === first && after.revision === before.revision + 1, 'Mouse placement failed or committed twice');
  checks.push('mouse drag: ghost, highlight, preview pure, release commits once');
  await mouseDrag(await center(handCard), await center(slot, 2));
  before = await saved(); await mouseDrag(await center(slot, 0), await center(slot, 2));
  after = await saved(); assert(after.battle.slots[0] === before.battle.slots[2] && after.battle.slots[2] === before.battle.slots[0], 'Occupied swap failed');
  const handLeft = await evaluate(`(()=>{const r=document.querySelector('.v2-hand-scroll').getBoundingClientRect();return {x:r.left+12,y:r.top+60}})()`);
  await mouseDrag(await center(slot, 2), handLeft); after = await saved(); assert(after.battle.hand[0] === first && after.battle.slots[2] === null, 'Return to hand position failed');
  const moving = after.battle.hand[3]; await mouseDrag(await center(handCard, 3), handLeft);
  assert((await saved()).battle.hand[0] === moving, 'Hand reordering failed'); checks.push('occupied swap, return to insertion point, hand reorder');
  before = await saved();
  await mouseDrag(await center(handCard), { x: 1420, y: 350 }); assert(JSON.stringify(await saved()) === JSON.stringify(before), 'Invalid drop changed game');
  const destination = await center(slot, 4); await mouseDrag(await center(handCard), destination, false);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await pointer('mouseReleased', destination, false); assert(JSON.stringify(await saved()) === JSON.stringify(before), 'Escape changed game');
  checks.push('invalid drop and Escape preserve state');
  const cancelFrom = await center(handCard);
  await mouseDrag(cancelFrom, destination, false);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await delay(650);
  await pointer('mouseReleased', cancelFrom, false); await delay(60);
  assert(await evaluate(`document.querySelector('[data-testid="v2-hand-card"]').getAttribute('aria-pressed')==='false'`), 'Delayed release selected cancelled card');
  const occupied = await center(slot, 0);
  await pointer('mousePressed', occupied, true); await pointer('mouseReleased', occupied, false);
  await pointer('mousePressed', occupied, true, 2); await pointer('mouseMoved', { x: 1420, y: 350 }, true); await pointer('mouseMoved', occupied, true); await pointer('mouseReleased', occupied, false, 2); await delay(60);
  assert(JSON.stringify(await saved()) === JSON.stringify(before), 'Trailing double-click changed game');
  checks.push('delayed release after Escape and native double-click after drag stay harmless');
  await click('设置'); await wait('.v2-settings');
  await evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(l=>l.innerText.includes('启用卡牌拖动'));label.querySelector('input').click();})()`);
  assert(await evaluate(`JSON.parse(localStorage.getItem('five-arrays-v2-settings')).dragEnabled===false`), 'Drag preference not saved');
  await click('返回远征'); await wait('.v2-battle');
  before = await saved(); await mouseDrag(await center(handCard), await center(slot, 1)); assert((await saved()).revision === before.revision, 'Disabled drag still worked');
  await evaluate(`document.querySelector('[data-testid="v2-hand-card"]').click()`); await delay(60);
  await evaluate(`document.querySelectorAll('[data-testid="v2-slot"]')[1].click()`); await delay(60);
  assert((await saved()).revision === before.revision + 1, 'Click fallback broken'); checks.push('drag setting saved; disabled drag leaves click path intact');
  await click('设置'); await wait('.v2-settings'); await click('恢复默认操作'); await screenshot('16-operation-settings');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await fresh();
  const swipeDistances = [];
  for (let round = 0; round < 3; round++) {
    if (round > 0) await fresh();
    const row = await evaluate(`(()=>{const r=document.querySelector('.v2-hand-scroll').getBoundingClientRect();return {left:r.left,right:r.right,y:r.top+65}})()`);
    before = await saved(); const swipeStart = { x: row.right - 35, y: row.y };
    for (let swipe = 0; swipe < 2; swipe++) {
      const left = await evaluate(`document.querySelector('.v2-hand-scroll').scrollLeft`);
      await touch('touchStart', swipeStart);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', { x: swipeStart.x - 145 * i / 6, y: swipeStart.y }); await delay(14); }
      await touch('touchEnd'); await delay(250);
      const scrolled = await evaluate(`document.querySelector('.v2-hand-scroll').scrollLeft`);
      assert(scrolled > left + 30, `Touch swipe ${swipe + 1} blocked (${left} -> ${scrolled})`);
      swipeDistances.push(scrolled - left);
    }
    assert(JSON.stringify(await saved()) === JSON.stringify(before), 'Touch swipe changed game');
    const visible = await evaluate(`(()=>{const row=document.querySelector('.v2-hand-scroll').getBoundingClientRect();const c=[...document.querySelectorAll('[data-testid="v2-hand-card"]')].find(c=>{const r=c.getBoundingClientRect();return r.left>=row.left&&r.right<=row.right});const r=c.getBoundingClientRect();return {id:c.dataset.dragCardId,x:r.left+r.width/2,y:r.top+55}})()`);
    await touch('touchStart', visible); await delay(360);
    assert(await evaluate(`!!document.querySelector('[role="tooltip"]') && !document.querySelector('[data-testid="v2-drag-ghost"]')`), 'Touch hold did not show details before movement');
    const touchTarget = await center(slot, 1);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', { x: visible.x + (touchTarget.x - visible.x) * i / 8, y: visible.y + (touchTarget.y - visible.y) * i / 8 }); await delay(20); }
    assert(await evaluate(`!!document.querySelector('[data-testid="v2-drag-ghost"]')`), `Browser cancelled long-press drag in round ${round + 1}`);
    if (round === 2) await screenshot('17-touch-drag-preview');
    await touch('touchEnd'); await delay(150);
    after = await saved(); assert(after.battle.slots[1] === visible.id, 'Touch long-press placement failed');
    assert(after.revision === before.revision + 1 && after.battle.playsLeft === 4 && after.battle.discardsLeft === 3, 'Drag committed twice or spent battle resources');
  }
  checks.push('three rounds: two hand swipes then immediate long-press drag; no blocked scroll or resource cost');
  before = await saved(); const touchFrom = await center(slot, 1);
  await touch('touchStart', touchFrom); await delay(360); await touch('touchCancel'); await delay(80);
  assert(JSON.stringify(await saved()) === JSON.stringify(before) && await evaluate(`!document.querySelector('[data-testid="v2-drag-ghost"]')`), 'Native touch cancellation changed cards');
  checks.push('native touchcancel removes ghost and preserves save');
  await screenshot('18-drag-mobile-result');
  await call('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: true }); await screenshot('19-drag-small-mobile');
  before = await saved();
  const verticalFrom = await evaluate(`(()=>{const r=document.querySelector('.v2-hand-scroll').getBoundingClientRect();return {x:r.left+55,y:Math.min(innerHeight-12,r.top+55)}})()`);
  await touch('touchStart', verticalFrom);
  for (let i = 1; i <= 7; i++) { await touch('touchMove', { x: verticalFrom.x, y: verticalFrom.y - 180 * i / 7 }); await delay(15); }
  await touch('touchEnd'); await delay(250);
  assert(await evaluate('scrollY>20'), 'Vertical page swipe from hand blocked');
  assert(JSON.stringify(await saved()) === JSON.stringify(before), 'Vertical swipe changed cards');
  checks.push('hand area still allows native vertical page scrolling');
  await fresh(); await click('弃牌');
  const discardFrom = await evaluate(`(()=>{const r=document.querySelector('.v2-hand-scroll').getBoundingClientRect();return {x:r.right-35,y:r.top+55}})()`);
  before = await saved(); await touch('touchStart', discardFrom);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', { x: discardFrom.x - 145 * i / 6, y: discardFrom.y }); await delay(14); }
  await touch('touchEnd'); await delay(80);
  assert(await evaluate(`document.querySelector('.v2-hand-scroll').scrollLeft>30`), 'Discard-mode hand swipe blocked');
  assert(JSON.stringify(await saved()) === JSON.stringify(before), 'Discard swipe changed cards');
  checks.push('discard mode keeps hand swipe without spending or discarding');
  await click('设置'); await wait('.v2-settings');
  await screenshot('20-operation-settings-mobile');
  await evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(l=>l.innerText.includes('启用卡牌拖动'));label.querySelector('input').click();})()`);
  await fresh(); before = await saved();
  const disabledFrom = await evaluate(`(()=>{const r=document.querySelector('.v2-hand-scroll').getBoundingClientRect();return {x:r.right-35,y:r.top+55}})()`);
  await touch('touchStart', disabledFrom);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', { x: disabledFrom.x - 145 * i / 6, y: disabledFrom.y }); await delay(14); }
  await touch('touchEnd'); await delay(250);
  assert(await evaluate(`document.querySelector('.v2-hand-scroll').scrollLeft>30`), 'Disabled drag blocked native hand swipe');
  assert(JSON.stringify(await saved()) === JSON.stringify(before), 'Disabled-drag swipe changed cards');
  checks.push('disabled dragging restores native hand swipe');
  assert(errors.length === 0, errors.join('\n'));
  await fs.writeFile('artifacts/v2/drag-validation.json', JSON.stringify({ checks, swipeDistances, errors }, null, 2)); console.log(JSON.stringify({ checks, swipeDistances, errors }, null, 2));
} finally { ws.close(); }
