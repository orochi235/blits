// Loads the built extension into headless Chromium, runs the fireworks app without its in-page
// panel, opens the extension's panel page for that tab, and drives it: pick, hold, step, then
// "Reload with history" and scrub. Fails on a page error or on any step that finds nothing.
// `--shots <dir>` keeps the screenshots, which otherwise go to a temp directory removed on exit.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = 4897;
const ext = fileURLToPath(new URL('../dist/', import.meta.url));
const app = fileURLToPath(new URL('../../fireworks/', import.meta.url));
const at = process.argv.indexOf('--shots');
const shots = at > 0 ? process.argv[at + 1] : mkdtempSync(join(tmpdir(), 'devtools-smoke-'));
mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'devtools-profile-'));

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: app,
  stdio: ['ignore', 'pipe', 'inherit'],
});
const ready = new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => {
    if (String(d).includes('Local')) resolve();
  });
  server.on('exit', (code) => reject(new Error(`vite exited with ${code}`)));
});

let context;
const errors = [];
let n = 0;
const step = async (name, fn) => {
  await fn();
  console.log(`${++n}  ${name}`);
};
try {
  await ready;
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
    viewport: { width: 1280, height: 800 },
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const app = await context.newPage();
  for (const p of [app]) {
    p.on('pageerror', (e) => errors.push(`app: ${e.message}`));
  }
  const url = `http://localhost:${PORT}/?nopanel`;

  await step('load the app with no in-page panel', async () => {
    await app.goto(url);
    await app.click('#start');
    await app.waitForTimeout(1500);
    if ((await app.locator('[data-blits-panel]').count()) > 0)
      throw new Error('the in-page panel mounted');
  });
  const tab = await worker.evaluate(
    async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id,
    url,
  );
  if (typeof tab !== 'number') throw new Error('no tab for the app');
  const panel = await context.newPage();
  panel.on('pageerror', (e) => errors.push(`panel: ${e.message}`));
  panel.on('console', (m) => {
    if (m.type() === 'error') errors.push(`panel: ${m.text()}`);
  });
  await step('open the panel page for the tab and pick the mix', async () => {
    await panel.goto(`chrome-extension://${id}/panel.html?tab=${tab}`);
    const option = panel.locator('select[aria-label="mix"] option', { hasText: 'show' });
    await option.first().waitFor({ state: 'attached', timeout: 10_000 });
    await panel.selectOption(
      'select[aria-label="mix"]',
      await option.first().getAttribute('value'),
    );
  });
  await step('pick a subject and plot it', async () => {
    await panel.locator('ul[aria-label="subjects"] button').first().waitFor({ timeout: 10_000 });
    await panel.locator('ul[aria-label="subjects"] button').first().click();
    await panel.waitForTimeout(800);
    if ((await panel.locator('.bp-plots figure').count()) === 0) throw new Error('no plots');
  });
  await panel.screenshot({ path: join(shots, 'picked.png') });
  await step('hold and step', async () => {
    await panel.click('.bp-bar button[title="hold the clock"]');
    await panel.locator('.bp-bar button[title="free the clock"]').waitFor();
    await panel.waitForTimeout(150);
    const still = await panel.locator('.bp-bar .bp-time').textContent();
    await panel.waitForTimeout(400);
    if ((await panel.locator('.bp-bar .bp-time').textContent()) !== still)
      throw new Error('held clock moved');
    await panel.click('.bp-bar button[title="step one frame"]');
    await panel.waitForTimeout(200);
    if ((await panel.locator('.bp-bar .bp-time').textContent()) === still)
      throw new Error('step did not move');
    await panel.click('.bp-bar button[title="free the clock"]');
  });
  await step('reload with history, and scrub back', async () => {
    await panel.click('button:has-text("Reload with history")');
    await panel.locator('button:has-text("Stop history")').waitFor({ timeout: 15_000 });
    await app.waitForLoadState();
    await app.click('#start');
    await app.waitForTimeout(1500);
    const option = panel.locator('select[aria-label="mix"] option', { hasText: 'show' });
    await option.first().waitFor({ state: 'attached', timeout: 10_000 });
    await panel.selectOption(
      'select[aria-label="mix"]',
      await option.first().getAttribute('value'),
    );
    await panel
      .locator('.bp-note', { hasText: 'added by the debugger' })
      .waitFor({ timeout: 5000 });
    await panel.click('.bp-bar button[title="hold the clock"]');
    await panel.locator('.bp-bar button[title="free the clock"]').waitFor();
    await panel.waitForTimeout(150);
    const scrub = panel.locator('.bp-bar .bp-scrub');
    if (await scrub.isDisabled()) throw new Error('scrub bar stayed off with history');
    await scrub.fill(await scrub.getAttribute('min'));
    await panel.waitForTimeout(200);
  });
  await panel.screenshot({ path: join(shots, 'scrubbed.png') });
  if (errors.length > 0) throw new Error(`errors:\n${errors.join('\n')}`);
  console.log(`ok: ${n} steps; screenshots in ${shots}`);
} finally {
  await context?.close();
  server.kill();
  rmSync(profile, { recursive: true, force: true });
  if (at < 0) rmSync(shots, { recursive: true, force: true });
}
