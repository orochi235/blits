import { fileURLToPath } from 'node:url';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

const src = (file) => fileURLToPath(new URL(`../src/${file}`, import.meta.url));

export default defineConfig({
  site: process.env.BLITS_SITE_URL ?? 'https://michaelbaker.tech',
  base: process.env.BLITS_SITE_BASE ?? '/',
  trailingSlash: 'always',
  integrations: [react(), mdx(), sitemap()],
  outDir: process.env.BLITS_SITE_OUT ?? './dist',
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: 'light' },
  },
  server: { host: '::', port: 4880 },
  vite: {
    resolve: {
      alias: [
        { find: /^@msb235\/blits$/, replacement: src('index.ts') },
        { find: /^@msb235\/blits\/lean$/, replacement: src('lean.ts') },
        { find: /^@msb235\/blits\/testing$/, replacement: src('testing.ts') },
        {
          find: /^@msb235\/blits-panel$/,
          replacement: fileURLToPath(new URL('../packages/panel/src/index.ts', import.meta.url)),
        },
      ],
    },
  },
});
