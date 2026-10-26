import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
// @ts-expect-error ESLint 扁平配置是 JavaScript 文件，不参与本工程 TypeScript 编译
import eslintConfig from '../../../eslint.config.js';

const linter = new Linter({ configType: 'flat' });

type LintMessage = { ruleId: string | null };

function lintAs(code: string, filename: string): LintMessage[] {
  return linter.verify(code, eslintConfig, filename) as LintMessage[];
}

function ruleIds(code: string, filename: string): Array<string | null> {
  return lintAs(code, filename).map((message) => message.ruleId);
}

describe('依赖方向边界', () => {
  it('领域层不得引入 React', () => {
    const ids = ruleIds("import { useState } from 'react';\nexport const use = useState;\n", 'src/domain/systems/fixture.ts');
    expect(ids).toContain('no-restricted-imports');
  });

  it('领域层不得引入界面层别名', () => {
    const ids = ruleIds(
      "import { CardView } from '@ui/cards/card-view';\nexport const view = CardView;\n",
      'src/domain/systems/fixture.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('领域层不得用相对路径穿透到基础设施层', () => {
    const ids = ruleIds(
      "import { readSave } from '../../infrastructure/storage/local-storage-save-repository';\nexport const read = readSave;\n",
      'src/domain/systems/fixture.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('领域层不得引入应用层', () => {
    const ids = ruleIds(
      "import { GameController } from '@app/game-controller';\nexport const controller = GameController;\n",
      'src/domain/systems/fixture.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('领域层不得直接使用 Math.random', () => {
    const ids = ruleIds('export const roll = (): number => Math.random();\n', 'src/domain/systems/fixture.ts');
    expect(ids).toContain('no-restricted-syntax');
  });

  it('领域层不得直接使用 Date', () => {
    const ids = ruleIds('export const now = (): number => Date.now();\n', 'src/domain/systems/fixture.ts');
    expect(ids).toContain('no-restricted-syntax');
  });

  it('领域层不得直接使用 window 与 localStorage', () => {
    const ids = ruleIds(
      "export const seed = (): string => window.localStorage.getItem('seed') ?? '';\n",
      'src/domain/systems/fixture.ts',
    );
    expect(ids).toContain('no-restricted-syntax');
  });

  it('领域层内部的合法引用不被拦截', () => {
    const ids = ruleIds(
      "import type { RngPort } from '@domain/ports/rng-port';\nexport const make = (port: RngPort): RngPort => port;\n",
      'src/domain/systems/fixture.ts',
    );
    expect(ids).not.toContain('no-restricted-imports');
    expect(ids).not.toContain('no-restricted-syntax');
  });

  it('zod 只允许出现在配置层', () => {
    const allowed = ruleIds(
      "import { z } from 'zod';\nexport const schema = z.string();\n",
      'src/config/schemas/card.schema.ts',
    );
    expect(allowed).not.toContain('no-restricted-imports');

    const rejected = ruleIds(
      "import { z } from 'zod';\nexport const schema = z.string();\n",
      'src/application/selectors.ts',
    );
    expect(rejected).toContain('no-restricted-imports');
  });
});
