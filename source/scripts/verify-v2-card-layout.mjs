import fs from 'node:fs/promises';

// Run against a disposable Chrome profile: this resets only that profile's game data.
const pages = await (await fetch('http://127.0.0.1:9460/json/list')).json();
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let next = 0;
const pending = new Map(), errors = [], sizes = [], checks = [];
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
  if (process.argv.includes('--no-screenshots')) return;
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
try {
  await call('Runtime.enable'); errors.length = 0; await call('Page.enable');
  await call('Page.navigate', { url: 'http://127.0.0.1:5178/' }); await wait('.v2-main-menu');
  await evaluate('localStorage.clear()');
  for (const [width, height] of [[1440, 900], [1280, 720], [768, 1024], [430, 932], [390, 844], [360, 640], [320, 568]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 760 });
    await fresh();
    const original = await cardGeometry(`${hand} .v2-card-face`);
    await evaluate(`document.querySelector(${JSON.stringify(hand)}).click()`); await delay(40);
    await evaluate(`document.querySelector(${JSON.stringify(slot)}).click()`); await delay(40);
    const staged = await cardGeometry(`${slot} .v2-card-face`);
    assert(Math.abs(original.width - staged.width) < 0.5 && Math.abs(original.height - staged.height) < 0.5,
      `${width}x${height}: staging resized card ${JSON.stringify(original)} -> ${JSON.stringify(staged)}`);
    assert(Math.abs(original.height / original.width - 10 / 7) < 0.015, `${width}: wrong card ratio`);
    assert(staged.font === original.font && !staged.compact && staged.type === original.type && staged.profession === original.profession, `${width}: staging changed card content`);
    assert(Math.abs(staged.artWidth - original.artWidth) < 0.5 && Math.abs(staged.artHeight - original.artHeight) < 0.5, `${width}: artwork changed shape on staging`);
    const geometry = await evaluate(`(()=>{const row=document.querySelector('.v2-formation-scroll'),footer=document.querySelector('.v2-battle-actions').getBoundingClientRect();return {pageWidth:document.documentElement.scrollWidth,clientWidth:row?.clientWidth,scrollWidth:row?.scrollWidth,footerTop:footer.top,footerBottom:footer.bottom}})()`);
    assert(geometry.pageWidth <= width, `${width}: page overflows horizontally`);
    if (width <= 760) {
      assert(geometry.scrollWidth > geometry.clientWidth, `${width}: formation must scroll instead of shrinking cards`);
      assert(geometry.footerTop >= 0 && geometry.footerBottom <= height + 1, `${width}: battle actions inaccessible`);
      await evaluate(`document.querySelector('.v2-formation-scroll').scrollLeft=10000`);
      const last = await evaluate(`(()=>{const r=document.querySelectorAll('[data-testid="v2-slot"]')[4].getBoundingClientRect();return {left:r.left,right:r.right}})()`);
      assert(last.left >= 0 && last.right <= width, `${width}: fifth slot not reachable`);
      await evaluate(`document.querySelector('.v2-formation-scroll').scrollLeft=0`);
    }
    sizes.push({ width, height, card: staged, ...geometry });
    if (width === 1440) await screenshot('21-fixed-card-desktop');
    if (width === 390) await screenshot('22-fixed-card-mobile');
    if (width === 360) await screenshot('23-fixed-card-small-mobile');
    if (width === 320) await screenshot('24-fixed-card-compact-mobile');
  }
  checks.push('seven viewports: stage preserves card dimensions, ratio, art, type, profession and text');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await fresh();
  const before = await saved(), original = await cardGeometry(`${hand} .v2-card-face`);
  const ghost = await touchDrag(await center(hand), await center(slot));
  assert(Math.abs(ghost.width - original.width) < 0.5 && Math.abs(ghost.height - original.height) < 0.5 && !ghost.compact, 'Touch ghost changed card dimensions or content');
  assert((await saved()).battle.slots[0] === before.battle.hand[0], 'Mobile placement failed');
  const row = await evaluate(`(()=>{const r=document.querySelector('.v2-formation-scroll').getBoundingClientRect();return {x:r.right-25,y:r.top+60}})()`);
  await touch('touchStart', row);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', { x: row.x - 180 * i / 6, y: row.y }); await delay(16); }
  await touch('touchEnd'); await delay(80);
  assert(await evaluate(`document.querySelector('.v2-formation-scroll').scrollLeft>50`), 'Mobile formation swipe failed');
  const target = await center(slot, 4);
  await touchDrag(await center(hand), target);
  const after = await saved(); assert(after.battle.slots[4] === before.battle.hand[1], 'Long press after formation swipe failed');
  assert(after.revision === before.revision + 2 && after.battle.playsLeft === before.battle.playsLeft, 'Layout interactions spent resources or committed twice');
  checks.push('formation swipe then immediate long-press drag to fifth slot; unchanged ghost, one commit, no resource cost');
  await screenshot('25-mobile-formation-scroll');
  const handStart = await evaluate(`(()=>{const r=document.querySelector('.v2-hand-scroll').getBoundingClientRect();return {x:r.left+10,y:r.top+60}})()`);
  await touchDrag(await center(slot, 4), handStart);
  assert((await saved()).battle.hand[0] === before.battle.hand[1] && (await saved()).battle.slots[4] === null, 'Returning card from scrolled formation failed');
  await evaluate(`document.querySelector('.v2-formation-scroll').scrollLeft=0`);
  const edgeFrom = await center(hand), edgeTarget = await evaluate(`(()=>{const r=document.querySelector('.v2-formation-scroll').getBoundingClientRect();return {x:r.right-5,y:r.top+80}})()`);
  const edgeBefore = await saved();
  await touch('touchStart', edgeFrom); await delay(340);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', { x: edgeFrom.x + (edgeTarget.x - edgeFrom.x) * i / 8, y: edgeFrom.y + (edgeTarget.y - edgeFrom.y) * i / 8 }); await delay(16); }
  await delay(500);
  assert(await evaluate(`document.querySelector('.v2-formation-scroll').scrollLeft>150`), 'Formation edge autoscroll failed');
  assert((await saved()).revision === edgeBefore.revision, 'Autoscroll committed early');
  await touch('touchEnd'); await delay(80);
  assert((await saved()).battle.slots[4] === edgeBefore.battle.hand[0], 'Drop after edge autoscroll failed');
  checks.push('scrolled formation returns to exact hand position; drag at edge reveals and fills fifth slot');
  await click('设置'); await wait('.v2-settings');
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Mobile settings overflow');
  await click('返回远征'); await wait('.v2-battle'); await click('总览'); await wait('[role="dialog"]');
  assert(await evaluate(`(()=>{const r=document.querySelector('[role="dialog"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height<=innerHeight})()`), 'Mobile hand overview does not fit');
  checks.push('mobile settings and hand overview fit the viewport');
  assert(errors.length === 0, errors.join('\n'));
  await fs.writeFile('artifacts/v2/card-layout-validation.json', JSON.stringify({ checks, sizes, errors }, null, 2));
  console.log(JSON.stringify({ checks, sizes, errors }, null, 2));
} finally { ws.close(); }
