// Runs the fireworks app's dev server with the panel mounted, drives the panel in headless
// Chromium, and fails on a page error or on any step that finds nothing. `--shots <dir>` keeps the
// screenshots, which otherwise go to a temp directory removed on exit.
import { join } from 'node:path';
import { chromium } from 'playwright';
import { changed, smoke } from '../../../apps/fireworks/scripts/smoke-harness.mjs';

await smoke('panel', { port: 4899 }, async ({ origin, shots, step, watch, defer }) => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  defer(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(10_000);
  watch('app', page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const time = () => page.locator('.bp-bar .bp-time').textContent();

  await step('load the app with the pill on it', async () => {
    await page.goto(origin);
    await page.locator('.bp-pill').waitFor();
  });
  await step('start the show', async () => {
    await page.click('#start');
    await page.waitForTimeout(1500);
  });
  await step('open the window and pick the mix', async () => {
    await page.click('.bp-pill button[title="open"]');
    await page.locator('.bp-window').waitFor();
    const id = await page
      .locator('select[aria-label="mix"] option', { hasText: 'show' })
      .first()
      .getAttribute('value');
    await page.selectOption('select[aria-label="mix"]', id);
  });
  await step('list subjects and pick one', async () => {
    await page.locator('ul[aria-label="subjects"] button').first().click();
    await page.waitForTimeout(800);
    const plots = await page.locator('.bp-plots figure').count();
    if (plots === 0) throw new Error('no plots drawn for the picked subject');
  });
  await page.screenshot({ path: join(shots, 'picked.png') });
  await step('hold, step and scrub', async () => {
    await page.click('.bp-bar button[title="hold the clock"]');
    await page.locator('.bp-bar button[title="free the clock"]').waitFor();
    await page.waitForTimeout(100);
    const before = await time();
    await page.waitForTimeout(500);
    const still = await time();
    if (before !== still) throw new Error(`held clock moved: ${before} → ${still}`);
    await page.click('.bp-bar button[title="step one frame"]');
    const stepped = await changed(time, still, 'step');
    const scrub = page.locator('.bp-bar .bp-scrub');
    if (await scrub.isDisabled()) throw new Error('scrub bar stayed off with history added');
    await scrub.fill(String(Number(await scrub.getAttribute('min')) + 100));
    await changed(time, stepped, 'scrub');
  });
  await page.screenshot({ path: join(shots, 'held.png') });
  await step('free the clock and unmount nothing broken', async () => {
    await page.click('.bp-bar button[title="free the clock"]');
    await page.waitForTimeout(300);
    if (errors.length > 0) throw new Error(`page errors:\n${errors.join('\n')}`);
  });
});
