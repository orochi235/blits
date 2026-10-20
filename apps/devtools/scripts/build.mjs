// Builds the unpacked extension into dist/: the panel and DevTools pages and the worker as modules,
// and the three scripts that go into a page as classic scripts, which is all Chrome injects.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const at = (path) => fileURLToPath(new URL(path, import.meta.url));
const root = at('..');
const outDir = at('../dist');
const resolve = {
  alias: {
    '@msb235/blits': at('../../../src/index.ts'),
    '@msb235/blits-panel': at('../../../packages/panel/src/index.ts'),
  },
};

rmSync(outDir, { recursive: true, force: true });

await build({
  root,
  base: './',
  configFile: false,
  logLevel: 'warn',
  plugins: [react()],
  resolve,
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: {
      input: {
        panel: at('../panel.html'),
        devtools: at('../devtools.html'),
        worker: at('../src/worker.ts'),
      },
      output: { entryFileNames: '[name].js' },
    },
  },
});

for (const name of ['start', 'page', 'relay'])
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    resolve,
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: at(`../src/${name}.ts`),
        formats: ['iife'],
        name: `blits_${name}`,
        fileName: () => `${name}.js`,
      },
    },
  });

console.log(`built ${outDir}`);
