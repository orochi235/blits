// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => {
  let resume = () => {};
  return {
    started: new Promise<void>((r) => {
      resume = r;
    }),
    resume: () => resume(),
    sounds: 0,
  };
});

vi.mock('tone', () => ({ start: () => audio.started }));
vi.mock('@msb235/blits-panel', () => ({ mount: () => {} }));
vi.mock('@msb235/blits-tone', () => ({
  drive: () => ({ attach() {}, detach() {}, write() {} }),
}));
vi.mock('../src/sky', () => ({
  createSky: () => ({ system: {}, render() {}, toWorld: () => ({ x: 0, y: 5 }) }),
}));
vi.mock('../src/sound', () => ({
  createSounds: () => {
    audio.sounds++;
    return { play() {}, borrow: () => undefined, giveBack() {} };
  },
}));
vi.mock('@msb235/blits-quarks', async (actual) => ({
  ...(await actual<object>()),
  drive: () => ({ attach() {}, detach() {}, write() {} }),
}));

describe('the fireworks page', () => {
  it('starts the show once, however often "Start the show" is clicked while audio resumes', async () => {
    const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<main'), html.indexOf('</main>') + 7);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    await import('../src/main.js');
    const start = document.getElementById('start') as HTMLButtonElement;
    start.click();
    start.click();
    audio.resume();
    await audio.started;
    await Promise.resolve();
    expect(audio.sounds).toBe(1);
    expect(start.hidden).toBe(true);
    vi.unstubAllGlobals();
  });
});
