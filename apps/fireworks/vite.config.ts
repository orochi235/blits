import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // Develop against the engine's and the drivers' source; the published packages ship dist.
      '@msb235/blits-quarks': at('../../packages/quarks/src/index.ts'),
      '@msb235/blits-tone': at('../../packages/tone/src/index.ts'),
      '@msb235/blits': at('../../src/index.ts'),
      '@fw': at('./src'),
    },
  },
  server: {
    host: '::',
    port: 4883,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
});
