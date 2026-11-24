// Loads the built extension into headless Chromium, runs the fireworks app without its in-page
// panel, opens the extension's panel page for that tab, and drives it: pick, hold, step, then
// "Reload with history" and scrub. Fails on a page error or on any step that finds nothing.
// `--shots <dir>` keeps the screenshots, which otherwise go to a temp directory removed on exit.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { smoke } from '../../fireworks/scripts/smoke-harness.mjs';

const ext = fileURLToPath(new URL('../dist/', import.meta.url));

await smoke('devtools', { port: 4897 }, async ({ origin, shots, step, watch, defer }) => {
  const profile = mkdtempSync(join(tmpdir(), 'devtools-profile-'));
  defer(() => rmSync(profile, { recursive: true, force: true }));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
    viewport: { width: 1280, height: 800 },
  });
  defer(() => context.close());
  context.setDefaultTimeout(10_000);
  const errors = [];
  const url = `${origin}?nopanel`;
  let worker;
  let app;
  let panel;
  let tab;

  await step('find the extension and load the app with no in-page panel', async () => {
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    app = await context.newPage();
    watch('app', app);
    app.on('pageerror', (e) => errors.push(`app: ${e.message}`));
    await app.goto(url);
    await app.click('#start');
    await app.waitForTimeout(1500);
    if ((await app.locator('[data-blits-panel]').count()) > 0)
      throw new Error('the in-page panel mounted');
    tab = await worker.evaluate(
      async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id,
      url,
    );
    if (typeof tab !== 'number') throw new Error('no tab for the app');
  });
  const pickShow = async () => {
    const option = panel.locator('select[aria-label="mix"] option', { hasText: 'show' });
    await option.first().waitFor({ state: 'attached' });
    await panel.selectOption(
      'select[aria-label="mix"]',
      await option.first().getAttribute('value'),
    );
  };
  const time = () => panel.locator('.bp-bar .bp-time').textContent();
  await step('open the panel page for the tab and pick the mix', async () => {
    panel = await context.newPage();
    watch('panel', panel);
    panel.on('pageerror', (e) => errors.push(`panel: ${e.message}`));
    panel.on('console', (m) => {
      if (m.type() === 'error') errors.push(`panel: ${m.text()}`);
    });
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html?tab=${tab}`);
    await pickShow();
  });
  await step('pick a subject and plot it', async () => {
    await panel.locator('ul[aria-label="subjects"] button').first().click();
    await panel.waitForTimeout(800);
    if ((await panel.locator('.bp-plots figure').count()) === 0) throw new Error('no plots');
  });
  await panel.screenshot({ path: join(shots, 'picked.png') });
  await step('hold and step', async () => {
    await panel.click('.bp-bar button[title="hold the clock"]');
    await panel.locator('.bp-bar button[title="free the clock"]').waitFor();
    await panel.waitForTimeout(150);
    const still = await time();
    await panel.waitForTimeout(400);
    const later = await time();
    if (later !== still) throw new Error(`held clock moved: ${still} → ${later}`);
    await panel.click('.bp-bar button[title="step one frame"]');
    await panel.waitForTimeout(200);
    if ((await time()) === still) throw new Error(`step did not move the clock from ${still}`);
    await panel.click('.bp-bar button[title="free the clock"]');
  });
  await step('reload with history', async () => {
    await panel.click('button:has-text("Reload with history")');
    await panel.locator('button:has-text("Stop history")').waitFor({ timeout: 15_000 });
    await app.waitForLoadState();
    await app.click('#start');
    await app.waitForTimeout(1500);
    await pickShow();
    // The show keeps history of its own, which the mark's default leaves alone.
    const mark = await app.evaluate(() => sessionStorage.getItem('blits-devtools:history'));
    if (mark !== '10000') throw new Error(`history mark reads ${mark}`);
    await panel.locator('.bp-note', { hasText: 'its own' }).waitFor({ timeout: 5000 });
  });
  await step('hold and scrub back', async () => {
    await panel.click('.bp-bar button[title="hold the clock"]');
    await panel.locator('.bp-bar button[title="free the clock"]').waitFor();
    await panel.waitForTimeout(150);
    const scrub = panel.locator('.bp-bar .bp-scrub');
    if (await scrub.isDisabled()) throw new Error('scrub bar stayed off with history');
    const held = await time();
    const [min, max, value] = await scrub.evaluate((el) => [el.min, el.max, el.value]);
    await scrub.fill(min);
    await panel.waitForTimeout(200);
    const after = await time();
    if (after === held) {
      const seen = await app.evaluate(() => document.visibilityState);
      throw new Error(
        `scrub did not move the clock: ${held} before and after; ` +
          `bar min ${min}, max ${max}, value ${value}; app tab ${seen}`,
      );
    }
  });
  await panel.screenshot({ path: join(shots, 'scrubbed.png') });
  await step('no page errors', async () => {
    if (errors.length > 0) throw new Error(errors.join('\n'));
  });
});
