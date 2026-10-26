import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      projects: [
        {
          test: {
            name: 'domain-and-config',
            environment: 'node',
            include: ['src/tests/**/*.test.{ts,tsx}'],
            exclude: ['src/tests/ui/**'],
          },
        },
        {
          test: {
            name: 'ui',
            environment: 'jsdom',
            include: ['src/tests/ui/**/*.test.{ts,tsx}', 'src/ui/**/*.test.{ts,tsx}'],
          },
        },
      ],
    },
  }),
);
