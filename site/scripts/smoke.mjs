// Loads every page of the built site in headless Chromium, runs its explainers, scrubs back once,
// and fails on any console error or page error. `--shots <dir>` also saves a screenshot per page.
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = process.env.BLITS_SITE_OUT
  ? `${resolve(fileURLToPath(new URL('..', import.meta.url)), process.env.BLITS_SITE_OUT)}/`
  : fileURLToPath(new URL('../dist/', import.meta.url));
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

// The site is built under its base path, so the server strips it before reading dist.
const base = (process.env.BLITS_SITE_BASE ?? '/').replace(/\/?$/, '/');

const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!url.startsWith(base)) {
    res.writeHead(404).end();
    return;
  }
  let path = join(root, url.slice(base.length - 1));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name === 'index.html') pages.push(`/${relative(root, dir)}/`.replace('//', '/'));
  }
})(root);
pages.sort();

const browser = await chromium.launch({ headless: true });
let failed = 0;
for (const [i, path] of pages.entries()) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + base.slice(0, -1) + path, { waitUntil: 'networkidle' });
  const explainers = await page.locator('.explainer').count();
  await page.waitForTimeout(explainers ? 2000 : 200);
  for (let k = 0; k < explainers; k++) {
    const range = page.locator('.explainer input[type=range]').nth(k);
    await range.scrollIntoViewIfNeeded();
    await range.fill('0');
  }
  if (explainers) await page.waitForTimeout(300);
  if (shots) {
    const name = path === '/' ? 'home' : path.replaceAll('/', '');
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  }
  const ok = errors.length === 0;
  if (!ok) failed++;
  console.log(
    `${String(i + 1).padStart(2)}/${pages.length}  ${ok ? 'ok  ' : 'FAIL'}  ${path}  ${explainers} explainer${explainers === 1 ? '' : 's'}`,
  );
  for (const e of errors) console.log(`       ${e}`);
  await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
