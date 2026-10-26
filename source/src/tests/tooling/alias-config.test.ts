import { describe, expect, it } from 'vitest';
import { pathAliases } from '../../../vite.config';

describe('路径别名', () => {
  it('配置计划规定的五个别名与共享目录别名', () => {
    expect(Object.keys(pathAliases).sort()).toEqual(['@app', '@config', '@domain', '@infra', '@shared', '@ui']);
  });

  it('每个别名都指向 src 下的对应目录', () => {
    expect(pathAliases['@config']?.endsWith('src/config')).toBe(true);
    expect(pathAliases['@domain']?.endsWith('src/domain')).toBe(true);
    expect(pathAliases['@app']?.endsWith('src/application')).toBe(true);
    expect(pathAliases['@infra']?.endsWith('src/infrastructure')).toBe(true);
    expect(pathAliases['@ui']?.endsWith('src/ui')).toBe(true);
    expect(pathAliases['@shared']?.endsWith('src/shared')).toBe(true);
  });
});
