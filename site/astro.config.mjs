import { execFile } from 'node:child_process';
import { utimes } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { satteri } from '@astrojs/markdown-satteri';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { linkExports } from './src/api/prose.ts';

const base = process.env.BLITS_SITE_BASE ?? '/';
const engine = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * In dev, rebuilds `.generated/api.json` when the engine's source changes, and restarts the server
 * so the prose links read it: the link checker loads it once, at startup, so an export added while
 * the server runs is otherwise a broken link until a restart.
 */
function freshApi() {
  return {
    name: 'blits-fresh-api',
    hooks: {
      'astro:server:setup': ({ server }) => {
        let timer;
        server.watcher.add(engine);
        server.watcher.on('change', (file) => {
          if (!file.startsWith(engine) || !file.endsWith('.ts')) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            const cwd = fileURLToPath(new URL('.', import.meta.url));
            execFile('npm', ['run', 'api'], { cwd }, (error) => {
              if (error) return;
              const now = new Date();
              void utimes(fileURLToPath(import.meta.url), now, now);
            });
          }, 1000);
        });
      },
    },
  };
}
const src = (file) => fileURLToPath(new URL(`../src/${file}`, import.meta.url));

export default defineConfig({
  site: process.env.BLITS_SITE_URL ?? 'https://michaelbaker.tech',
  base,
  trailingSlash: 'always',
  integrations: [
    react(),
    mdx(),
    sitemap({ filter: (page) => !page.endsWith('/locus/') }),
    freshApi(),
  ],
  outDir: process.env.BLITS_SITE_OUT ?? './dist',
  markdown: {
    processor: satteri({ mdastPlugins: [linkExports(base.replace(/\/?$/, '/'))] }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: 'light' },
  },
  server: { host: '::', port: 4880 },
  vite: {
    resolve: {
      alias: [
        {
          find: /^bree$/,
          replacement: fileURLToPath(new URL('./vendor/bree/index.ts', import.meta.url)),
        },
        { find: /^@brand\//, replacement: fileURLToPath(new URL('../brand/', import.meta.url)) },
        { find: /^@msb235\/blits$/, replacement: src('index.ts') },
        { find: /^@msb235\/blits\/lean$/, replacement: src('lean.ts') },
        { find: /^@msb235\/blits\/gpu$/, replacement: src('gpu.ts') },
        { find: /^@msb235\/blits\/testing$/, replacement: src('testing.ts') },
        {
          find: /^@msb235\/blits-panel$/,
          replacement: fileURLToPath(new URL('../packages/panel/src/index.ts', import.meta.url)),
        },
        {
          find: /^@msb235\/blits-rapier$/,
          replacement: fileURLToPath(new URL('../packages/rapier/src/index.ts', import.meta.url)),
        },
      ],
    },
  },
});
