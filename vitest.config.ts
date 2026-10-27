import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The engine is not a workspace member, so a package testing against it reads its source.
  resolve: {
    alias: {
      '@msb235/blits': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      '@msb235/blits-panel': fileURLToPath(
        new URL('./packages/panel/src/index.ts', import.meta.url),
      ),
      '@pg': fileURLToPath(new URL('./apps/playground/src', import.meta.url)),
    },
  },
  test: {
    // For the tests that check a mix nobody holds is collected.
    execArgv: ['--expose-gc'],
    setupFiles: ['test/setup.ts'],
    include: [
      'test/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'apps/playground/test/**/*.test.ts',
      'apps/devtools/test/**/*.test.ts',
      'site/src/**/*.test.ts',
    ],
  },
});
