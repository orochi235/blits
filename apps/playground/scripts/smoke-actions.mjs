// The smoke run's actions beyond playing a preset: a live ramp and mute on the mix, a save that
// opens again, and the debug panel on `?panel`. Returns what went wrong, empty when nothing did.
import { join } from 'node:path';

export async function actions(browser, origin, shots) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(origin, { waitUntil: 'networkidle' });
    // weasel's switch keeps its input visually hidden, under the track a click lands on.
    await page.getByRole('switch', { name: 'live' }).check({ force: true });
    await page.getByLabel('ramp or mute over, ms').fill('300');
    await page.getByLabel('mix rate').fill('2');
    await page.getByRole('button', { name: 'mute' }).click();
    await page.waitForTimeout(800);
    const rest = await page.getByText(/^subject 0 (at rest|moving)$/).textContent();
    if (rest !== 'subject 0 at rest') errors.push(`after a mute over 300 ms, "${rest}"`);

    await page.getByRole('tab', { name: 'Voice' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'save' }).click(),
    ]);
    const saved = join(shots, download.suggestedFilename());
    await download.saveAs(saved);
    if (download.suggestedFilename() !== 'stagger-wave.blits.json')
      errors.push(`saved as ${download.suggestedFilename()}`);
    await pickPreset(page, 'crossfade');
    await page.locator('input[type=file]').setInputFiles(saved);
    await page.waitForTimeout(200);
    const title = await presetMenu(page).textContent();
    if (title !== 'stagger wave') errors.push(`opening the saved file shows "${title}"`);
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.getByText('bad.json holds no composition').waitFor({ timeout: 2000 });

    await page.goto(`${origin}?panel`, { waitUntil: 'networkidle' });
    errors.push(...(await panelHolds(page)));
    await page.screenshot({ path: join(shots, 'panel.png') });
  } catch (e) {
    errors.push(e.message.split('\n')[0]);
  }
  await page.close();
  return errors;
}

/** The header's preset select, whose trigger is named for its value and the row's label. */
export const presetMenu = (page) => page.getByRole('button', { name: /preset$/ });

export async function pickPreset(page, name) {
  await presetMenu(page).click();
  await page.getByRole('option', { name, exact: true }).click();
}

const stageHash = (page) =>
  page.locator('canvas[aria-label=stage]').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let k = 0; k < d.length; k += 97) h = (h * 31 + d[k]) | 0;
    return h;
  });
const scoreTime = (page) =>
  page
    .getByText(/^\d+\.\d\ds \/ /)
    .first()
    .textContent();

/** The panel's hold keeps the stage and the score still, its step and scrub move them, and a hold outlasts the score's length. */
async function panelHolds(page) {
  const errors = [];
  await page.locator('.bp-pill').waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  await page.locator('button[title="hold the clock"]').click();
  await page.waitForTimeout(150);
  const held = [await stageHash(page), await scoreTime(page)];
  await page.waitForTimeout(700);
  const later = [await stageHash(page), await scoreTime(page)];
  if (held[0] !== later[0]) errors.push("the stage moved under the panel's hold");
  if (held[1] !== later[1])
    errors.push(`the score ran on under the hold: ${held[1]} then ${later[1]}`);
  await page.locator('button[title="step one frame"]').click();
  await page.waitForTimeout(150);
  if ((await stageHash(page)) === later[0])
    errors.push("the panel's step left the stage where it was");
  const before = await stageHash(page);
  await page.locator('input.bp-scrub').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(Number(el.min) + 100));
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  });
  await page.waitForTimeout(150);
  if ((await stageHash(page)) === before)
    errors.push("the panel's scrub left the stage where it was");
  await page.waitForTimeout(4500);
  if ((await page.locator('button[title="free the clock"]').count()) === 0)
    errors.push('the hold was lost within one score length');
  return errors;
}
