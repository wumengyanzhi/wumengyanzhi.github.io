import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = [path.join(here, 'dist'), path.resolve(here, '../dist'), here].find(dir => fs.existsSync(path.join(dir, 'index.html')));
if (!root) { console.error('找不到游戏文件，请完整解压后启动。'); process.exit(1); }
const requested = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 5180);
if (!Number.isInteger(requested) || requested < 1024 || requested > 65535) throw new Error('端口无效');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { response.writeHead(404); response.end('未找到文件'); return; }
    response.setHeader('Content-Type', types[path.extname(filename)] ?? 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-cache');
    const stream = fs.createReadStream(filename); stream.on('error', () => { if (!response.headersSent) response.writeHead(500); response.end(); }); stream.pipe(response);
  } catch { response.writeHead(400); response.end('请求无效'); }
});
server.on('error', error => { console.error(`启动失败：${error.message}。请关闭此前启动的同一游戏窗口后重试。`); process.exitCode = 1; });
server.listen(requested, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${requested}`;
  console.log(`五阵破军已启动：${url}\n请保留此窗口。按 Ctrl+C 退出。`);
  if (!process.argv.includes('--no-open')) {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const browser = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.log(`请手动打开 ${url}`)); browser.unref();
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
