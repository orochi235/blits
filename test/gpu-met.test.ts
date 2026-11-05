import { createHistory } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { gpu, gpuOf, mixerOf } from '../src/gpu/engine.js';
import { kit, mix, spring, sum } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
import type { Voice } from '../src/voice.js';
import { fakeDevice } from './gpu-device.js';

interface C {
  x: number;
}
interface P {
  y: number;
}

/** A gpu mix with history whose spring, cued at 100 over `cells`, the side has folded at 200. */
async function folded() {
  const d = fakeDevice();
  const cells = Array.from({ length: 4 }, (_, x) => ({ x }));
  const m = mix<C, P>(kit<P>({ y: sum() }), {
    engine: gpu({ device: d.device }),
    history: { ms: 1e5, tape: createHistory },
  });
  m.sync(0);
  m.sync(100);
  const s = spring<C, P>('y', { to: (c) => c.x });
  m.cue({ patch: s, subjects: cells });
  const side = gpuOf(m);
  side.subjects(cells, () => ({}));
  side.channel('y');
  await side.ready;
  m.sync(200);
  side.channel('y');
  const mixer = mixerOf(m) as unknown as Mixer<C, unknown>;
  const voice = mixer.cued[0] as Voice<C, unknown>;
  const unheld = (c: C) => mixer.unheld?.(voice, c);
  return { m, s, side, cells, voice, unheld };
}

describe('gpu met voices', () => {
  it('count a folded voice met for every registered subject it reaches', async () => {
    const { cells, unheld } = await folded();
    expect(cells.map(unheld)).toEqual([0, 0, 0, 0]);
  });

  it('forget a voice parked by a seek back before its cue, and after it is cued again', async () => {
    const { m, cells, unheld } = await folded();
    m.seek(50);
    expect(unheld(cells[0] as C)).toBeUndefined();
    m.sync(400);
    expect(unheld(cells[0] as C)).toBeUndefined();
  });

  it("let a motion's read answer on a fold alone as it does on the CPU after a probe", async () => {
    const d = fakeDevice();
    const cells = Array.from({ length: 4 }, (_, x) => ({ x }));
    const make = (gpuSide: boolean) => {
      const m = mix<C, P>(
        kit<P>({ y: sum() }),
        gpuSide ? { engine: gpu({ device: d.device }) } : {},
      );
      const s = spring<C, P>('y', { to: (c) => c.x, stiffness: 40, damping: 12 });
      m.sync(0);
      m.cue({ patch: s, subjects: cells, stagger: (c) => c.x * 10 });
      return { m, s };
    };
    const g = make(true);
    const c = make(false);
    const side = gpuOf(g.m);
    side.subjects(cells, () => ({}));
    side.channel('y');
    await side.ready;
    const frame = (t: number) => {
      g.m.sync(t);
      side.channel('y');
      c.m.sync(t);
      for (const cell of cells) c.m.probe(cell);
    };
    frame(16);
    for (const cell of cells) {
      g.s.to(cell, 9);
      c.s.to(cell, 9);
    }
    for (let t = 32; t <= 160; t += 16) {
      frame(t);
      for (const cell of cells) expect(g.s.read(cell)).toEqual(c.s.read(cell));
    }
  });

  it('forget a dropped subject until the next fold meets it again', async () => {
    const { m, side, cells, unheld } = await folded();
    m.drop(cells[1] as C);
    expect(cells.map(unheld)).toEqual([0, undefined, 0, 0]);
    m.sync(216);
    side.channel('y');
    expect(cells.map(unheld)).toEqual([0, 0, 0, 0]);
  });
});
