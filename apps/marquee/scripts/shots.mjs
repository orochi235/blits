// Screenshots each text effect alone (`?show=<name>`) at a few moments, and the rainbow layer over
// a held message, into `--out <dir>` (default shots/), for looking at what an effect draws.
// `--only flip,tile` takes just those.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const out = arg('--out', 'shots');
const only = arg('--only', null)?.split(',');
mkdirSync(out, { recursive: true });

const MOMENTS = [700, 1500, 2500, 3300];
const views = [
  { name: 'hold', query: '?show=hold' },
  { name: 'scroll', query: '?show=scroll' },
  { name: 'flip', query: '?show=flip' },
  { name: 'roll', query: '?show=roll' },
  { name: 'fall', query: '?show=fall' },
  { name: 'tile', query: '?show=tile&cols=120&rows=40' },
  { name: 'rainbow', query: '?show=hold', click: '#rainbow' },
].filter((v) => !only || only.includes(v.name));

const { origin, close } = await serve();
const browser = await chromium.launch({ headless: true });
let failed = 0;
try {
  for (const [i, v] of views.entries()) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${origin}${v.query}&nopanel`, { waitUntil: 'networkidle' });
    if (v.click) await page.click(v.click);
    const start = Date.now();
    for (const t of MOMENTS) {
      await page.waitForTimeout(Math.max(0, t - (Date.now() - start)));
      await page.screenshot({ path: join(out, `${v.name}-${t}.png`) });
    }
    console.log(`${i + 1}/${views.length}  ${errors.length ? 'FAIL' : 'ok  '}  ${v.name}`);
    for (const e of errors) console.log(`      ${e}`);
    if (errors.length) failed++;
    await page.close();
  }
} finally {
  await browser.close();
  close();
}
process.exit(failed ? 1 : 0);
