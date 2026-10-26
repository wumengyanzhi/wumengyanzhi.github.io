import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:5178';
const healthPath = '/__five_arrays_health';
const shouldOpen = !process.argv.includes('--no-open');
function open() {
  if (!shouldOpen) return;
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', origin] : [origin];
  const child = spawn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' });
  child.on('error', () => console.log(`请在浏览器打开 ${origin}`)); child.unref();
}
try {
  const old = await fetch(origin + healthPath, { signal: AbortSignal.timeout(1200) }).then(r => r.json()).catch(() => null);
  if (old?.root === root && old?.app === 'five-arrays') { console.log(`游戏已运行：${origin}`); open(); }
  else {
    const server = await createServer({ root, server: { host: '127.0.0.1', port: 5178, strictPort: true }, plugins: [{
      name: 'five-arrays-launcher', configureServer(vite) { vite.middlewares.use(healthPath, (_request, response) => {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ app: 'five-arrays', root }));
      }); },
    }] });
    await server.listen(); console.log(`五阵破军已启动：${origin}\n保留此窗口即可游玩，按 Ctrl+C 停止。`); open();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void server.close().then(() => process.exit(0)));
  }
} catch (error) { console.error(`启动失败：${error.message}`); process.exitCode = 1; }
