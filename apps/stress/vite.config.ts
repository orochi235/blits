import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@msb235/blits': at('../../src/index.ts'),
      '@stress': at('./src'),
    },
  },
  server: {
    host: '::',
    port: 4885,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
});
