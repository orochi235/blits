// Builds the unpacked extension into dist/: the panel and DevTools pages and the worker as modules,
// and the three scripts that go into a page as classic scripts, which is all Chrome injects.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// The extension is the panel, so it carries the panel's version, and the brand's b as its icon.
const manifest = JSON.parse(readFileSync(at('../dist/manifest.json'), 'utf8'));
manifest.version = JSON.parse(
  readFileSync(at('../../../packages/panel/package.json'), 'utf8'),
).version;
writeFileSync(at('../dist/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
mkdirSync(at('../dist/icons'), { recursive: true });
for (const size of Object.keys(manifest.icons))
  copyFileSync(
    at(`../../../brand/out/png/mark-panel-${size}.png`),
    at(`../dist/icons/${size}.png`),
  );

console.log(`built ${outDir}`);
