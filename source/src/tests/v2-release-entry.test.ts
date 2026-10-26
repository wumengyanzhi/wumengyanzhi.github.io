import { build } from 'vite';
import { expect, it, vi } from 'vitest';

it('正式构建只收录完整游戏，不包含旧游戏、实验室和数值演练', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  let result;
  try {
    result = await build({
      mode: 'production',
      logLevel: 'silent',
      build: { write: false, sourcemap: false },
    });
  } finally {
    vi.unstubAllEnvs();
  }
  const bundles = Array.isArray(result) ? result : [result];
  const modules = bundles.flatMap(bundle => 'output' in bundle
    ? bundle.output.flatMap(output => output.type === 'chunk' ? Object.keys(output.modules) : [])
    : []);
  expect(modules.some(id => id.replace(/\\/g, '/').endsWith('/src/v2/ui/game-app.tsx'))).toBe(true);
  expect(modules.filter(id => /\/src\/(?:App\.tsx$|lab\/|v2\/simulation[^/]*)/.test(id.replace(/\\/g, '/')))).toEqual([]);
}, 30_000);
