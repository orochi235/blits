import { describe, expect, it } from 'vitest';
import { kit, max, mul, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';
import type { Handle, Mix, MixOptions } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
  dark: number;
  position: number[];
  opacity: number;
}
const K = kit<Pose>({
  gain: mul(),
  crawl: sum(),
  dark: max(),
  position: vec(3, sum()),
  opacity: mul({ bounds: [0, 1] }),
});
const every = Object.keys(K) as (keyof Pose)[];

interface Part {
  id: number;
}

type Played = { handles?: Handle<Part>[]; at?: (t: number) => void } | undefined;
type Play = (m: Mix<Part, Pose>, parts: Part[]) => Played;

function expectSame(a: Pose, b: Pose, where: string): void {
  for (const key of every) {
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x) && Array.isArray(y)) {
      expect(x.length, `${where} ${key}.length`).toBe(y.length);
      x.forEach((v, i) => {
        expect(Object.is(v, y[i]), `${where} ${key}[${i}]: ${v} vs ${y[i]}`).toBe(true);
      });
    } else expect(Object.is(x, y), `${where} ${key}: ${x} vs ${y}`).toBe(true);
  }
}

/**
 * Plays one scenario on a mix with lanes off and one with them on, building it afresh for each so
 * nothing is shared. At every time it probes the parts `probe` picks, into a fresh pose and into a
 * reused out object, and requires every channel, every handle's `weightOf` and `atRest` to match.
 */
function agree(
  play: Play,
  opts: {
    times: readonly number[];
    parts?: number;
    probe?: (t: number, part: Part) => boolean;
    mix?: MixOptions;
  },
): void {
  const n = opts.parts ?? 6;
  const runs = [false, true].map((lanes) => {
    const parts = Array.from({ length: n }, (_, id) => ({ id }));
    const m = mix<Part, Pose>(K, { ...opts.mix, lanes });
    const r = play(m, parts) ?? {};
    return { m, parts, handles: r.handles ?? [], at: r.at, out: {} as Pose };
  });
  for (const t of opts.times) {
    const seen = runs.map((run) => {
      run.at?.(t);
      run.m.sync(t);
      const poses: Pose[] = [];
      const weights: number[] = [];
      const rest: boolean[] = [];
      for (const part of run.parts) {
        if (opts.probe && !opts.probe(t, part)) continue;
        poses.push(run.m.probe(part));
        poses.push({ ...run.m.probe(part, run.out) });
        for (const h of run.handles) weights.push(h.weightOf(part));
        rest.push(run.m.atRest(part));
      }
      return { poses, weights, rest };
    });
    const [off, on] = seen as [(typeof seen)[0], (typeof seen)[0]];
    off.poses.forEach((pose, i) => {
      expectSame(pose, on.poses[i] as Pose, `t=${t} probe ${i}`);
    });
    expect(on.weights, `t=${t} weightOf`).toEqual(off.weights);
    expect(on.rest, `t=${t} atRest`).toEqual(off.rest);
  }
}

const times = [0, 16, 50, 120, 333, 500, 999, 1000, 1500, 2600];

const pulse = () =>
  keys<Part, Pose>(
    1000,
    [
      { at: 0, delta: { gain: 0.1, position: [0, 0, 0], opacity: 0.2 } },
      { at: 0.4, delta: { gain: 0.9, position: [5, -2, 1], opacity: 1.4 }, ease: 'ease-in-out' },
      { at: 1, delta: { gain: 0.1, position: [0, 0, 0], opacity: 0.2 } },
    ],
    { ease: { bezier: [0.3, 0.1, 0.2, 1] } },
  );

describe('lanes give the pose the general path gives', () => {
  it('for a keys voice over every subject', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse() });
      },
      { times },
    );
  });
});
