import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import type { Answers } from '../src/gpu/answers.js';
import { gpu, gpuOf, mixerOf } from '../src/gpu/engine.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { kit, mix, sum } from '../src/index.js';
import type { Mix } from '../src/types.js';
import type { Voice } from '../src/voice.js';
import { fakeDevice } from './gpu-device.js';

// A gpu side's table of `stagger` answers, replayed after a seek back, with a `stagger` answering
// anew on every ask: a replay that asked again would place a subject elsewhere than the live mix.

interface C {
  id: string;
}
interface P {
  y: number;
}
const K = kit<P>({ y: sum() });
const a = { id: 'a' };
const b = { id: 'b' };
const cells = [a, b];
const wave = shaderPatch<C, P>(200, {
  wgsl: 'out.y = phase;',
  at: (phase) => ({ y: phase }),
  writes: ['y'],
});

const frames: number[] = [];
for (let t = 0; t <= 480; t += 16) frames.push(t);

type Engine = 'gpu' | 'cpu';
type Scene = (m: Mix<C, P>, t: number, stagger: (s: C) => number) => void;
type Delays = (number | undefined)[];

/**
 * Plays `scene` live, folding on the gpu side or probing on the CPU each frame, then seeks back to
 * each of `to` in turn and plays on to the end again, checking each frame's delays against the
 * live run's. Answers the asks made live and in all.
 */
async function replays(engine: Engine, scene: Scene, ...to: number[]) {
  const asks: C[] = [];
  const stagger = (s: C) => {
    asks.push(s);
    return 40 * asks.length;
  };
  const d = fakeDevice();
  const m = mix<C, P>(K, {
    name: 'stagger seek',
    history: { ms: 1e5, every: 50, tape },
    stepMs: 4,
    ...(engine === 'gpu' ? { engine: gpu({ device: d.device }) } : {}),
  });
  m.sync(0);
  const side = engine === 'gpu' ? gpuOf(m) : null;
  side?.subjects(cells, () => ({}));
  // Each subject's delay as the engine folds it: from the gpu side's table, or the CPU's record.
  const shown = (): Delays => {
    const voice = mixerOf(m).cued[0] as Voice<C, unknown> | undefined;
    if (voice === undefined) return [];
    if (side === null) {
      for (const c of cells) m.probe(c);
      return cells.map((c) => voice.subjects.get(c)?.delay);
    }
    expect(side.channel('y')).not.toBeNull();
    const { delays } = (side as unknown as { answers: Answers<C> }).answers.of(voice);
    return cells.map((_, i) => delays?.[i]);
  };
  let folding = side === null;
  const live = new Map<number, Delays>();
  const mixT = new Map<number, number>();
  for (const t of frames) {
    m.sync(t);
    scene(m, t, stagger);
    if (!folding && side !== null && mixerOf(m).cued.length > 0) {
      side.channel('y');
      await side.ready;
      folding = true;
    }
    live.set(t, shown());
    mixT.set(t, m.now);
  }
  const askedLive = asks.slice();
  let host = frames[frames.length - 1] as number;
  for (const from of to) {
    m.seek(mixT.get(from) as number);
    const base = host;
    for (const f of frames.filter((f) => f > from)) {
      host = base + (f - from);
      m.sync(host);
      expect(shown(), `frame ${f} after a seek back to ${from}`).toEqual(live.get(f));
    }
  }
  return { askedLive, asks };
}

describe('a replay after a seek back takes the answers `stagger` gave live', () => {
  for (const engine of ['gpu', 'cpu'] as const)
    describe(`on the ${engine} engine`, () => {
      it('asks for no subject again', async () => {
        const { askedLive, asks } = await replays(
          engine,
          (m, t, stagger) => {
            if (t === 0) m.cue({ patch: wave, loop: true, stagger });
          },
          48,
        );
        expect(askedLive).toEqual([a, b]);
        expect(asks).toEqual(askedLive);
      });

      it('asks for no subject again after the drop it plays again', async () => {
        const { askedLive, asks } = await replays(
          engine,
          (m, t, stagger) => {
            if (t === 0) m.cue({ patch: wave, loop: true, stagger });
            if (t === 96) m.drop(b);
          },
          48,
        );
        expect(askedLive).toEqual([a, b, b]);
        expect(asks).toEqual(askedLive);
      });

      it('asks for no subject again over two seeks back', async () => {
        const { askedLive, asks } = await replays(
          engine,
          (m, t, stagger) => {
            if (t === 0) m.cue({ patch: wave, loop: true, stagger });
            if (t === 96) m.drop(b);
            if (t === 304) m.drop(a);
          },
          400,
          48,
        );
        expect(askedLive).toEqual([a, b, b, a]);
        expect(asks).toEqual(askedLive);
      });

      it('asks for no subject again for a voice cued after the moment sought', async () => {
        const { askedLive, asks } = await replays(
          engine,
          (m, t, stagger) => {
            if (t === 80) m.cue({ patch: wave, loop: true, stagger });
            if (t === 160) m.drop(a);
          },
          48,
        );
        expect(askedLive).toEqual([a, b, a]);
        expect(asks).toEqual(askedLive);
      });
    });
});
