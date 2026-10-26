import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

const BOUNDARY_MESSAGE = '依赖方向只能由外向内：领域层不得引用 React、界面层、应用层或基础设施层。';
const ZOD_MESSAGE = 'zod 只允许出现在 src/config/**，其他层不得直接引入配置校验库。';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.cache/**', 'artifacts/**'],
  },
  ...tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'import/no-unresolved': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: '禁止直接使用 Math.random()，随机必须经过注入的 RngPort。',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: '禁止直接使用 Date，时间必须经过注入的 ClockPort。',
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      'import/no-unresolved': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/config/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'zod', message: ZOD_MESSAGE }],
          patterns: [{ group: ['zod/*'], message: ZOD_MESSAGE }],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'zod', message: ZOD_MESSAGE }],
          patterns: [
            { group: ['react', 'react-dom', 'react-dom/*', 'react/*'], message: BOUNDARY_MESSAGE },
            { group: ['@ui', '@ui/*', '**/ui/**'], message: BOUNDARY_MESSAGE },
            { group: ['@app', '@app/*', '**/application/**'], message: BOUNDARY_MESSAGE },
            { group: ['@infra', '@infra/*', '**/infrastructure/**'], message: BOUNDARY_MESSAGE },
            { group: ['zod/*'], message: ZOD_MESSAGE },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: '领域层禁止直接使用 Math.random()，随机必须经过注入的 RngPort。',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: '领域层禁止直接使用 Date，时间必须经过注入的 ClockPort。',
        },
        {
          selector: "MemberExpression[object.name='Date']",
          message: '领域层禁止直接使用 Date，时间必须经过注入的 ClockPort。',
        },
        { selector: "Identifier[name='window']", message: '领域层禁止直接使用 window。' },
        { selector: "Identifier[name='document']", message: '领域层禁止直接使用 document。' },
        { selector: "Identifier[name='localStorage']", message: '领域层禁止直接使用 localStorage。' },
        { selector: "Identifier[name='sessionStorage']", message: '领域层禁止直接使用 sessionStorage。' },
      ],
    },
  },
);
