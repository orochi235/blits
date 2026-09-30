import { fileURLToPath } from 'node:url';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

export default defineConfig({
  base: process.env.BLITS_SITE_BASE ?? '/',
  trailingSlash: 'always',
  integrations: [react(), mdx()],
  outDir: process.env.BLITS_SITE_OUT ?? './dist',
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: 'light' },
  },
  server: { host: '::', port: 4872 },
  vite: {
    resolve: {
      alias: { '@blits': fileURLToPath(new URL('../src', import.meta.url)) },
    },
  },
});
