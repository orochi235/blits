// Runs the fireworks app's dev server with the panel mounted, drives the panel in headless
// Chromium, and fails on a page error or on any step that finds nothing. `--shots <dir>` keeps the
// screenshots, which otherwise go to a temp directory removed on exit.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = 4899;
const app = fileURLToPath(new URL('../../../apps/fireworks/', import.meta.url));
const at = process.argv.indexOf('--shots');
const shots = at > 0 ? process.argv[at + 1] : mkdtempSync(join(tmpdir(), 'panel-smoke-'));
mkdirSync(shots, { recursive: true });

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

const steps = [];
let browser;
const errors = [];
try {
  await ready;
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const step = async (name, fn) => {
    await fn();
    steps.push(name);
    console.log(`${steps.length}  ${name}`);
  };

  await step('load the app with the pill on it', async () => {
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('.bp-pill').waitFor({ timeout: 10_000 });
  });
  await step('start the show', async () => {
    await page.click('#start');
    await page.waitForTimeout(1500);
  });
  await step('open the window and pick the mix', async () => {
    await page.click('.bp-pill button[title="open"]');
    await page.locator('.bp-window').waitFor();
    const id = await page.locator('select[aria-label="mix"] option', { hasText: 'show' }).first().getAttribute('value');
    await page.selectOption('select[aria-label="mix"]', id);
  });
  await step('list subjects and pick one', async () => {
    await page.locator('ul[aria-label="subjects"] button').first().waitFor({ timeout: 10_000 });
    await page.locator('ul[aria-label="subjects"] button').first().click();
    await page.waitForTimeout(800);
    const plots = await page.locator('.bp-plots figure').count();
    if (plots === 0) throw new Error('no plots drawn for the picked subject');
  });
  await page.screenshot({ path: join(shots, 'picked.png') });
  await step('hold, step and scrub', async () => {
    await page.click('.bp-bar button[title="hold the clock"]');
    const before = await page.locator('.bp-bar .bp-time').textContent();
    await page.waitForTimeout(500);
    const still = await page.locator('.bp-bar .bp-time').textContent();
    if (before !== still) throw new Error(`held clock moved: ${before} → ${still}`);
    await page.click('.bp-bar button[title="step one frame"]');
    await page.waitForTimeout(200);
    const stepped = await page.locator('.bp-bar .bp-time').textContent();
    if (stepped === still) throw new Error('step did not move the clock');
    const scrub = page.locator('.bp-bar .bp-scrub');
    if (await scrub.isDisabled()) throw new Error('scrub bar stayed off with history added');
    await scrub.fill(String(Number(await scrub.getAttribute('min')) + 100));
    await page.waitForTimeout(200);
  });
  await page.screenshot({ path: join(shots, 'held.png') });
  await step('free the clock and unmount nothing broken', async () => {
    await page.click('.bp-bar button[title="free the clock"]');
    await page.waitForTimeout(300);
  });
  if (errors.length > 0) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log(`ok: ${steps.length} steps; screenshots in ${shots}`);
} finally {
  await browser?.close();
  server.kill();
  if (at < 0) rmSync(shots, { recursive: true, force: true });
}
