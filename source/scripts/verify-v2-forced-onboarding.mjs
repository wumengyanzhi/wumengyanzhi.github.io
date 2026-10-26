import fs from 'node:fs/promises';

// CDP must use a disposable profile. The player's browser is never cleared.
const pages = await (await fetch('http://127.0.0.1:9460/json/list')).json();
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let next = 0;
const pending = new Map(), errors = [], checks = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result); }
  else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000); pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } }); ws.send(JSON.stringify({ id, method, params })); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
const assert = (value, message) => { if (!value) throw new Error(message); };
const wait = async selector => { for (let i = 0; i < 100; i++) { if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return; await delay(50); } throw new Error(`Missing ${selector}`); };
const current = () => evaluate(`JSON.parse(localStorage.getItem('three_kingdoms.tutorial.mobile_v2.v1'))`);
const expectStep = async step => assert((await current()).step === step, `Expected ${step}, got ${(await current()).step}`);
const slot = index => `[data-v2-slot="${index}"]`;
const hand = id => `[data-testid="v2-hand-card"][data-drag-card-id="${id}"]`;
const card = async suffix => { const s = await current(); return s.run.owned.find(id => s.run.cards[id].definitionId.endsWith(suffix)); };
const mouse = (type, point, pressed = false) => call('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
const touch = (type, point) => call('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1, radiusX: 2, radiusY: 2, force: 1 }] : [] });
const center = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
async function click(selector, physical = true) {
  await delay(110);
  if (!physical) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(70); return; }
  const p = await center(selector);
  assert(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),top=document.elementFromPoint(${p.x},${p.y});return e===top||e.contains(top)})()`), `Target occluded or outside viewport: ${selector} ${JSON.stringify(p)}`);
  await mouse('mouseMoved', p); await mouse('mousePressed', p, true); await mouse('mouseReleased', p); await delay(100);
}
const clickText = async text => { const selector = await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(${JSON.stringify(text)}));if(!b)throw Error('Missing '+${JSON.stringify(text)});b.setAttribute('data-qa-target','active');return '[data-qa-target="active"]'})()`); await click(selector); await evaluate(`document.querySelector('[data-qa-target="active"]')?.removeAttribute('data-qa-target')`); };
async function geometry() {
  const result = await evaluate(`(()=>{const b=document.querySelector('.v2-coachmark-bubble');if(!b)return null;const r=b.getBoundingClientRect();const holes=[...document.querySelectorAll('[data-coachmark-outline]')].map(x=>({left:+x.getAttribute('x'),top:+x.getAttribute('y'),right:+x.getAttribute('x')+ +x.getAttribute('width'),bottom:+x.getAttribute('y')+ +x.getAttribute('height')}));return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,holes,viewport:innerWidth,viewHeight:innerHeight}})()`);
  assert(result && result.left >= 0 && result.right <= result.viewport + 1 && result.top >= 0 && result.bottom <= result.viewHeight + 1, 'Coachmark overflows: ' + JSON.stringify(result));
  assert(result.height > 95, 'Coachmark squeezed unreadably: ' + JSON.stringify(result));
  return result;
}
async function screenshot(name) { if (process.argv.includes('--no-screenshots')) return; const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await fs.writeFile(`docs/完整游戏/截图/${name}.png`, Buffer.from(result.data, 'base64')); }
async function fresh() { await evaluate('localStorage.clear()'); await call('Page.reload'); await wait('[role="dialog"]'); }
async function firstBattle(phone = false) {
  await expectStep('select-character'); await geometry();
  await click(hand(await card('shu_zhong_meng_shi'))); await expectStep('place-character');
  // A real wrong-location click must leave both lesson and engine untouched.
  const before = JSON.stringify(await current()); await click(slot(0), false); assert(JSON.stringify(await current()) === before, 'Wrong target changed lesson');
  await click(slot(1)); await expectStep('select-weapon');
  await click(hand(await card('huan_shou_dao'))); await expectStep('place-weapon-gap');
  await click(slot(3)); await expectStep('select-staged-weapon'); await click(slot(3)); await expectStep('move-weapon');
  await click(slot(2)); await expectStep('compare'); await geometry(); await clickText('知道了'); await expectStep('drag-weapon');
  await geometry(); await screenshot(phone ? await evaluate('innerWidth') < 350 ? '42-forced-small-phone-drag' : '39-forced-phone-drag' : '38-forced-desktop-drag');
  const from = await center(slot(2)), to = await center(slot(0));
  assert(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(slot(2))}),top=document.elementFromPoint(${from.x},${from.y});return e===top||e.contains(top)})()`), `Drag source occluded: ${JSON.stringify({from,to})}`);
  if (phone) { await touch('touchStart', from); await delay(350); }
  else { await mouse('mouseMoved', from); await mouse('mousePressed', from, true); }
  for (let i = 1; i <= 12; i++) { const p = { x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 }; if (phone) await touch('touchMove', p); else await mouse('mouseMoved', p, true); await delay(20); }
  if (phone) await touch('touchEnd'); else await mouse('mouseReleased', to); await delay(150);
  assert((await current()).step === 'select-tactic', `Drag did not commit ${JSON.stringify(await evaluate(`({width:innerWidth,scroll:scrollY,touch:document.body.className,ghost:!!document.querySelector('[data-testid="v2-drag-ghost"]'),error:document.querySelector('[role="alert"]')?.innerText,source:document.querySelector('[data-v2-slot="2"]').getBoundingClientRect().toJSON(),from:${JSON.stringify(from)},to:${JSON.stringify(to)}})`))}`); await click(hand(await card('chou_cuo_jun_liang'))); await click(slot(3)); await expectStep('damage');
  await click('.v2-preview button'); await expectStep('damage-read'); await geometry();
  await click('[role="dialog"] button[aria-label="关闭"]'); await expectStep('play'); await click('.v2-play'); await expectStep('reward');
}
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: process.env.GAME_URL ?? 'http://127.0.0.1:5178/' }); await wait('.v2-app'); await fresh();
  await screenshot('37-first-visit-prompt'); await clickText('暂时跳过，直接游戏');
  assert(await evaluate(`localStorage.getItem('five-arrays-v2-onboarding-choice')==='declined'&&!localStorage.getItem('three_kingdoms.run.mobile_v2.save')`), 'Declining changed formal save');
  await call('Page.reload'); await wait('.v2-main-menu'); assert(!await evaluate(`!!document.querySelector('[role="dialog"]')`), 'Repeated first-visit prompt');
  await fresh(); await clickText('进入新手教程'); await wait('.v2-coachmark');
  await firstBattle(); await click('.v2-reward-card .v2-primary'); await expectStep('enhance'); await click('.v2-reward-card .v2-primary'); await expectStep('camp'); await click('.v2-training-camp .v2-primary');
  await expectStep('practice-discard'); await click('[data-tutorial-action="discard-open"]'); await expectStep('practice-pick-discard');
  const discardId = (await current()).checkpoint.battle.hand[7]; await click(hand(discardId)); await expectStep('practice-confirm-discard');
  await call('Page.reload'); await wait('.v2-main-menu'); await clickText('继续演武'); await expectStep('practice-confirm-discard');
  await click('[data-tutorial-action="discard-confirm"]'); await expectStep('practice');
  assert(!await evaluate(`!!document.querySelector('.v2-coachmark')`), 'Practice still locked');
  for (let round = 0; round < 4 && (await current()).step === 'practice'; round++) {
    for (let i = 0; i < 5; i++) { const id = (await current()).run.battle.hand[0]; await click(hand(id), false); await click(slot(i), false); }
    await evaluate(`document.querySelectorAll('.v2-choices select').forEach(s=>{const o=[...s.options].find(o=>o.value);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));}})`); await delay(80); await click('.v2-play', false);
  }
  await expectStep('complete'); assert(await evaluate(`!localStorage.getItem('three_kingdoms.run.mobile_v2.save')&&!localStorage.getItem('five-arrays-v2-history')`), 'Teaching created formal records');
  checks.push('首次同意/拒绝/刷新记忆、目标点击屏蔽、真实鼠标拖动、完整两场及弃牌步骤刷新恢复');
  // Phone replay uses the same real UI and touch drag, without injecting teaching actions.
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await fresh(); await clickText('进入新手教程'); await firstBattle(true); await screenshot('40-forced-phone-reward');
  await click('.v2-reward-card .v2-primary'); await click('.v2-reward-card .v2-primary'); await click('.v2-training-camp .v2-primary');
  await click('[data-tutorial-action="discard-open"]'); await click(hand((await current()).checkpoint.battle.hand[7])); await click('[data-tutorial-action="discard-confirm"]'); await expectStep('practice');
  await clickText('退出演武'); await clickText('继续演武'); await expectStep('practice');
  checks.push('390px手机逐步点击、真正触屏拖放、完整奖励强化和弃牌、退出后续练');
  await fresh(); await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true }); await clickText('进入新手教程');
  await geometry(); await screenshot('41-forced-small-phone'); await firstBattle(true);
  await clickText('退出演武'); await wait('.v2-main-menu'); await clickText('继续演武'); await expectStep('reward');
  await clickText('跳过教学'); await expectStep('skipped');
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), '320px overflow');
  checks.push('320px短屏完整首战、真实触屏拖放、气泡可读、横向定位、退出续练与跳过');
  assert(errors.length === 0, errors.join('\n')); console.log(JSON.stringify({ ok: true, checks, errors }, null, 2));
} finally { ws.close(); }
