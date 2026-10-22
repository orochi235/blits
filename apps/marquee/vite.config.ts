import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // Develop against the engine's source; the published package ships dist.
      '@msb235/blits-panel': at('../../packages/panel/src/index.ts'),
      '@msb235/blits': at('../../src/index.ts'),
    },
  },
  server: {
    host: '::',
    port: 4884,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
});
