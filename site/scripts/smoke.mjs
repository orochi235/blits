// Loads every page of the built site in headless Chromium, runs its explainers, scrubs back once,
// and fails on any console error or page error, on a page laid out wider than a phone's viewport,
// on a link into the site that leads nowhere, or on a build without its search index. `--shots <dir>` also saves a screenshot per page at each width.
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

/** The file a site path serves, or null where there is none. */
function fileAt(url) {
  if (!url.startsWith(base)) return null;
  let path = join(root, url.slice(base.length - 1));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  return existsSync(path) ? path : null;
}

const server = createServer((req, res) => {
  const path = fileAt(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path === null) {
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

const PHONE = { width: 390, height: 844 };

/** The page's layout width, and the elements whose right edge sets it past the viewport. */
function overflowing() {
  const limit = document.documentElement.clientWidth;
  const by = [];
  for (const el of document.querySelectorAll('body *')) {
    const { right, width } = el.getBoundingClientRect();
    if (right <= limit + 0.5 || width === 0) continue;
    // Scrolled within a parent that clips, so it widens nothing.
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') clipped = true;
    }
    if (clipped) continue;
    const cls =
      typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : '';
    by.push(`${el.tagName.toLowerCase()}${cls} ${Math.round(right)}`);
  }
  return { width: document.documentElement.scrollWidth, by: by.slice(0, 6) };
}

const browser = await chromium.launch({ headless: true });
let failed = 0;
if (fileAt(`${base}pagefind/pagefind.js`) === null) {
  console.log('FAIL  no search index: the build did not run pagefind');
  failed++;
}
for (const [i, path] of pages.entries()) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + base.slice(0, -1) + path, { waitUntil: 'networkidle' });
  const explainers = await page.locator('.explainer').count();
  await page.waitForTimeout(explainers ? 2000 : 200);
  for (let k = 0; k < explainers; k++) {
    const time = page.locator('.explainer').nth(k).locator('[role=slider][aria-label=Time]');
    await time.scrollIntoViewIfNeeded();
    await time.focus();
    await time.press('Home');
  }
  if (explainers) await page.waitForTimeout(300);
  // A live file runs only while on screen, so each is brought into view to run.
  const lives = await page.locator('.live').count();
  for (let k = 0; k < lives; k++) {
    await page.locator('.live').nth(k).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }
  if (shots) {
    const name = path === '/' ? 'home' : path.replaceAll('/', '');
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  }
  if (path === '/') {
    await page.fill('.search input', 'stagger');
    const hit = await page
      .locator('.search .results li a')
      .first()
      .waitFor({ timeout: 5000 })
      .then(
        () => true,
        () => false,
      );
    if (!hit) errors.push('a search for "stagger" found nothing');
  }
  const links = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
  for (const href of new Set(links)) {
    const url = new URL(href);
    if (url.origin !== origin) continue;
    if (fileAt(decodeURIComponent(url.pathname)) === null)
      errors.push(`links to ${url.pathname}, which is not there`);
  }
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(200);
  const wide = await page.evaluate(overflowing);
  if (wide.width > PHONE.width) {
    errors.push(`lays out ${wide.width} px wide at ${PHONE.width}: ${wide.by.join(', ')}`);
  }
  if (shots) {
    const name = path === '/' ? 'home' : path.replaceAll('/', '');
    await page.screenshot({ path: join(shots, `${name}-phone.png`), fullPage: true });
  }
  const ok = errors.length === 0;
  if (!ok) failed++;
  console.log(
    `${String(i + 1).padStart(2)}/${pages.length}  ${ok ? 'ok  ' : 'FAIL'}  ${path}  ${explainers} explainer${explainers === 1 ? '' : 's'}, ${lives} live`,
  );
  for (const e of errors) console.log(`       ${e}`);
  await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
