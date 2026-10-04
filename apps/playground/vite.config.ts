import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { forge } from '@weasel-js/forge/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const stories = process.argv.some((a) => a.includes('weaselforge'));

export default defineConfig({
  base: './',
  plugins: [react(), ...(stories ? forge({ stories: ['src/widgets/**/*.stories.tsx'] }) : [])],
  resolve: {
    alias: {
      // Develop against the engine's source; the published package ships dist.
      '@msb235/blits': at('../../src/index.ts'),
      '@pg': at('./src'),
    },
  },
  server: {
    host: '::',
    port: 4881,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
});
