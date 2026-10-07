// Loads the built playground once per preset in headless Chromium, plays a second, and fails on any
// console error, page error, or a stage that drew nothing. `--shots <dir>` keeps the screenshots,
// which otherwise go to a temp directory removed on exit.
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  let path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}/`;

const shotsAt = process.argv.indexOf('--shots');
const kept = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (kept) mkdirSync(kept, { recursive: true });
const shots = kept ?? mkdtempSync(join(tmpdir(), 'playground-smoke-'));

const browser = await chromium.launch({ headless: true });
let failed = 0;
try {
  const probe = await browser.newPage();
  await probe.goto(origin, { waitUntil: 'networkidle' });
  const names = await probe
    .getByLabel('preset')
    .locator('option:not([disabled])')
    .allTextContents();
  await probe.close();
  if (names.length === 0) throw new Error('no presets in the preset menu');
  for (const [i, name] of names.entries()) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByLabel('preset').selectOption({ label: name });
    await page.waitForTimeout(1000);
    const drawn = await page.locator('canvas[aria-label=stage]').evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let k = 3; k < d.length; k += 4) if (d[k] > 0) return true;
      return false;
    });
    if (!drawn) errors.push('stage drew nothing');
    const flowDrawn = await page
      .locator('section[aria-label=flow] canvas')
      .first()
      .evaluate((c) => {
        const g = c.getContext('2d');
        if (!g) return true; // a WebGL canvas: trust the console check
        const d = g.getImageData(0, 0, c.width, c.height).data;
        for (let k = 3; k < d.length; k += 4) if (d[k] > 0) return true;
        return false;
      })
      .catch(() => false);
    if (!flowDrawn) errors.push('flow drew nothing');
    await page.screenshot({
      path: join(shots, `${String(i + 1).padStart(2, '0')}-${name.replaceAll(' ', '-')}.png`),
    });
    const ok = errors.length === 0;
    if (!ok) failed++;
    console.log(`${String(i + 1).padStart(2)}/${names.length}  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    for (const e of errors) console.log(`       ${e}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  if (!kept) rmSync(shots, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
