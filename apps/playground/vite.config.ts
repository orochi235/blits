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
      '@msb235/blits-panel': at('../../packages/panel/src/index.ts'),
      '@pg': at('./src'),
    },
    // A weasel package symlinked to a local checkout would otherwise bring that checkout's copies.
    dedupe: [
      'react',
      'react-dom',
      '@weasel-js/animator',
      '@weasel-js/core',
      '@weasel-js/font',
      '@weasel-js/geom',
      '@weasel-js/simulation',
    ],
  },
  server: {
    host: '::',
    port: stories ? 4882 : 4881,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
});
