import fs from 'node:fs/promises';
const origin = process.env.GAME_URL ?? 'http://127.0.0.1:5180';
// Use a disposable browser profile; never point this check at the player's browser.
const cdp = process.env.CDP_URL ?? 'http://127.0.0.1:9460';
const pages = await (await fetch(cdp + '/json/list')).json();
const socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let next = 0;
const pending = new Map();
const errors = [];
socket.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); };
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, mobile: true, deviceScaleFactor: 1 });
  await call('Page.navigate', { url: origin + '/?legacy=1' });
  for (let i = 0; i < 100; i++) { if (await evaluate(`!!document.querySelector('.v2-main-menu')`)) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!(await evaluate(`!!document.querySelector('.v2-main-menu')`))) throw new Error('Release menu not loaded');
  await evaluate(`{ const skip=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('暂时跳过'));skip?.click(); }`);
  if (await evaluate(`/数值演练|测试版|调试/.test(document.body.innerText)`)) throw new Error('Development content present');
  await evaluate(`document.querySelector('[aria-label="踏上征途"]').click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  if (await evaluate(`!!document.querySelector('input')`)) throw new Error('Seed field present');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('确认出征')).click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const result = await evaluate(`({title:document.title,hand:document.querySelectorAll('[data-testid="v2-hand-card"]').length,slots:document.querySelectorAll('[data-testid="v2-slot"]').length,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,save:!!localStorage.getItem('three_kingdoms.run.mobile_v2.save')})`);
  if (result.hand !== 8 || result.slots !== 5 || !result.save || errors.length) throw new Error(JSON.stringify({ result, errors }));
  const art = await fetch(origin + '/art/characters.png');
  if (!art.ok) throw new Error('Packaged art missing');
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile('docs/完整游戏/截图/51-release-package-phone.png', Buffer.from(shot.data, 'base64'));
  await fs.writeFile('artifacts/v2/release-validation-2026-10-19.json', JSON.stringify({ ...result, art: art.status, errors }, null, 2));
  console.log(JSON.stringify({ ...result, art: art.status, errors }));
} finally { socket.close(); }
