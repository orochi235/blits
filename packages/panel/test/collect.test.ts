// @vitest-environment happy-dom
import { kit, mix, sum, type Watched, watched } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { agent } from '../src/agent.js';

const gc = (globalThis as { gc?: () => void }).gc;

/** Makes a mix, hands its entry to `use`, drops it, and says whether it is still listed after collection. */
async function kept(use: (e: Watched) => void): Promise<boolean> {
  let id = 0;
  (() => {
    const m = mix<unknown, { x: number }>(kit<{ x: number }>({ x: sum() }));
    m.sync(0);
    const e = watched()
      .entries()
      .find((x) => x.mix === m) as Watched;
    id = e.id;
    use(e);
    m.probe('s');
    m.sync(16);
  })();
  for (let i = 0; i < 10; i++) {
    gc?.();
    await new Promise((r) => setTimeout(r, 20));
  }
  return watched()
    .entries()
    .some((e) => e.id === id);
}

describe.skipIf(gc === undefined)('a mix the app drops', () => {
  it('is collected while watched, its stop function kept', async () => {
    const stops: (() => void)[] = [];
    expect(await kept((e) => stops.push(e.watch(() => {})))).toBe(false);
  });

  it('is collected while the panel has it picked', async () => {
    const a = agent();
    expect(await kept((e) => a.send({ kind: 'mix', id: e.id }))).toBe(false);
    a.dispose();
  });
});
