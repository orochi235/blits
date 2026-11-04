// Opens demos of the built site with `?panel` in headless Chromium with WebGPU, and checks what
// CLAUDE.md asks of a demo: the page loads with no console or page error, the panel lists the
// demo's mixes, holding the clock stills the picture, and a seek moves it. Build the site first.
//   node site/scripts/panel-check.mjs examples/white-balance:white-balance examples/light-board:light-board
// Each argument is a page and the mix names it should list, comma-separated. `--shots <dir>` keeps a
// screenshot of each demo held and after the seek; otherwise none are written.
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const at = process.argv.indexOf('--shots');
const shots = at > 0 ? process.argv[at + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const pages = process.argv
  .slice(2)
  .filter((a, i, all) => a !== '--shots' && all[i - 1] !== '--shots');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  let path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// The full browser in new headless mode reaches the real GPU; the default headless shell gets SwiftShader.
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu'],
});
let failed = 0;
console.log(`onto: plan ${pages.length}`);
for (const [k, arg] of pages.entries()) {
  const [path, names = ''] = arg.split(':');
  const want = names.split(',').filter(Boolean);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const problems = [];
  try {
    await page.goto(`${origin}/${path}/?panel`);
    await page.locator('.bp-pill').waitFor({ timeout: 15_000 });
    const demo = page.locator('figure.live').first();
    await demo.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const gpu = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
    await page.click('.bp-pill button[title="open"]');
    await page.locator('.bp-window').waitFor();
    const listed = await page.locator('select[aria-label="mix"] option').allTextContents();
    for (const n of want) if (!listed.includes(n)) problems.push(`panel does not list ${n}`);
    const id = await page
      .locator('select[aria-label="mix"] option', { hasText: want[0] ?? '' })
      .last()
      .getAttribute('value');
    await page.selectOption('select[aria-label="mix"]', id);
    await page.click('.bp-bar button[title="hold the clock"]');
    await page.locator('.bp-bar button[title="free the clock"]').waitFor();
    await page.waitForTimeout(300);
    const held = await demo.screenshot();
    await page.waitForTimeout(700);
    if (!held.equals(await demo.screenshot())) problems.push('the picture moved while held');
    const scrub = page.locator('.bp-bar .bp-scrub');
    if (await scrub.isDisabled()) problems.push('the scrub bar is off');
    else {
      const lo = Number(await scrub.getAttribute('min'));
      const hi = Number(await scrub.getAttribute('max'));
      await scrub.fill(String(Math.round(lo + (hi - lo) / 3)));
      await page.waitForTimeout(400);
      const sought = await demo.screenshot();
      if (held.equals(sought)) problems.push('the seek did not move the picture');
      if (shots) {
        const name = path.replaceAll('/', '-');
        writeFileSync(join(shots, `${name}-held.png`), held);
        writeFileSync(join(shots, `${name}-sought.png`), sought);
      }
    }
    await page.click('.bp-bar button[title="free the clock"]');
    await page.waitForTimeout(300);
    problems.push(...errors.map((e) => `console: ${e}`));
    console.log(
      `${k + 1}/${pages.length} ${problems.length === 0 ? '✓' : '✗'} ${path}  webgpu ${gpu ? 'yes' : 'no'}  mixes ${listed.slice(1).join(', ')}${problems.map((p) => `\n      ${p}`).join('')}`,
    );
  } catch (e) {
    problems.push(String(e));
    console.log(`${k + 1}/${pages.length} ✗ ${path}\n      ${problems.join('\n      ')}`);
  }
  if (problems.length > 0) failed++;
  await page.close();
}
await browser.close();
server.close();
console.log(failed === 0 ? 'all passed' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
