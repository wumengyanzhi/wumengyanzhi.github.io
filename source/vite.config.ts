import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = process.cwd().replace(/\\/g, '/');

export const pathAliases: Record<string, string> = {
  '@config': `${projectRoot}/src/config`,
  '@domain': `${projectRoot}/src/domain`,
  '@app': `${projectRoot}/src/application`,
  '@infra': `${projectRoot}/src/infrastructure`,
  '@ui': `${projectRoot}/src/ui`,
  '@shared': `${projectRoot}/src/shared`,
};

export default defineConfig({
  plugins: [react()],
  server: { watch: { ignored: ['**/.cache/**', '**/artifacts/**'] } },
  resolve: {
    alias: pathAliases,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
