import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The engine is not a workspace member, so a package testing against it reads its source.
  resolve: {
    alias: { '@msb235/blits': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  },
  test: { include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts'] },
});
