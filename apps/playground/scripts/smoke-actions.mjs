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
    await page.getByLabel('live', { exact: true }).check();
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
    const preset = page.getByLabel('preset');
    await preset.selectOption({ label: 'crossfade' });
    await page.locator('input[type=file]').setInputFiles(saved);
    await page.waitForTimeout(200);
    const title = await preset.evaluate((s) => s.options[s.selectedIndex]?.text);
    if (title !== 'stagger wave') errors.push(`opening the saved file shows "${title}"`);
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.getByText('bad.json holds no composition').waitFor({ timeout: 2000 });

    await page.goto(`${origin}?panel`, { waitUntil: 'networkidle' });
    await page.locator('[data-blits-panel]').waitFor({ state: 'attached', timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, 'panel.png') });
  } catch (e) {
    errors.push(e.message.split('\n')[0]);
  }
  await page.close();
  return errors;
}
