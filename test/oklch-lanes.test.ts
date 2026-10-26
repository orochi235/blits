import { describe, expect, it } from 'vitest';
import { kit, last } from '../src/channels.js';
import { color, oklab } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import type { Channel, Mix } from '../src/types.js';

interface Pose {
  tint: number[];
}
interface Part {
  id: number;
}
type Scene = (m: Mix<Part, Pose>, parts: Part[]) => void;

/**
 * Plays `scene` on a mix with lanes off and on, reading every part through `probe` and through
 * `pull` at each time; every number must be the same bits as the general path's.
 */
function agree(tint: Channel<number[]>, scene: Scene, times: readonly number[], n = 6): void {
  const runs = [false, true].map((lanes) => {
    const m = mix<Part, Pose>(kit<Pose>({ tint }), { lanes });
    const parts = Array.from({ length: n }, (_, id) => ({ id }));
    scene(m, parts);
    return { m, parts };
  });
  const lanes = (
    (runs[1] as (typeof runs)[0]).m as unknown as { lanes: { laned: { name: string }[] } }
  ).lanes;
  let laned = false;
  for (const t of times) {
    const [off, on] = runs.map(({ m, parts }) => {
      m.sync(t);
      const cols = { tint: new Float64Array(parts.length * 4) };
      m.pull(parts, cols);
      return [...parts.flatMap((p) => [...(m.probe(p).tint ?? [Number.NaN])]), ...cols.tint];
    }) as [number[], number[]];
    if (lanes.laned.some((c) => c.name === 'tint')) laned = true;
    expect(on.length, `t=${t} length`).toBe(off.length);
    on.forEach((v, i) => {
      expect(Object.is(v, off[i]), `t=${t} [${i}]: ${v} vs ${off[i]}`).toBe(true);
    });
  }
  expect(laned, 'tint laned').toBe(true);
}

const RED = oklab(0xff0000);
const BLUE = oklab(0x0000ff);
const CYAN = oklab(0x00ffff);
const GRAY = oklab(0x808080);
const sweep = (from: number[], to: number[], ms = 1000) =>
  keys<Part, Pose>(ms, [
    { at: 0, delta: { tint: from } },
    { at: 1, delta: { tint: to } },
  ]);
const holds = (c: number[]) => patch<Part, Pose>(0, () => ({ tint: c }), { writes: ['tint'] });
const TIMES = [0, 16, 250, 500, 640, 999, 1000, 1400];

describe("color({ lerp: 'oklch' }) runs on lanes, reading as the general path does", () => {
  const round = () => color({ lerp: 'oklch' });

  it('round the hue the short way, under a held color and over a fade', () => {
    agree(
      round(),
      (m) => {
        m.cue({ patch: holds(GRAY), weight: 0.3 });
        m.cue({ patch: sweep(RED, CYAN), fade: { in: 300 }, weight: 0.8 });
        m.cue({ patch: sweep(BLUE, oklab(0xffff00), 700), loop: true });
      },
      TIMES,
    );
  });

  it('from gray, black and white, and from no coverage', () => {
    agree(
      round(),
      (m) => {
        m.cue({ patch: sweep(GRAY, BLUE) });
        m.cue({ patch: sweep(RED, oklab(0x000000)), weight: 0.5 });
        m.cue({ patch: sweep(oklab(0xffffff), oklab(0x00ff00)), weight: 0.25 });
        m.cue({ patch: sweep([0, 0, 0, 0], CYAN), weight: 0.6 });
        m.cue({
          patch: sweep(
            oklab(0x123456).map((v) => v * 0.5),
            [0, 0, 0, 0],
          ),
        });
      },
      TIMES,
    );
  });

  it('in a role, whose members lerp through the channel', () => {
    agree(
      round(),
      (m) => {
        m.cue({ patch: sweep(RED, BLUE), role: 'one', weight: 0.7 });
        m.cue({ patch: sweep(CYAN, oklab(0xff00ff)), role: 'one', weight: 0.4 });
        m.cue({ patch: holds(oklab(0xffe08a)), role: 'one', weight: 0.5 });
      },
      TIMES,
    );
  });

  it('as a crowd of voices each on a subject of its own', () => {
    agree(
      round(),
      (m, parts) => {
        m.cue({ patch: sweep(GRAY, RED), weight: 0.5 });
        for (const p of parts)
          m.cue({
            patch: sweep(RED, p.id % 2 ? CYAN : BLUE, 600 + 50 * p.id),
            subjects: [p],
            fade: { in: 100 },
          });
      },
      TIMES,
      40,
    );
  });

  it('replacing, as color(last()) does', () => {
    agree(
      color(last(), { lerp: 'oklch' }),
      (m) => {
        m.cue({ patch: sweep(RED, CYAN) });
        m.cue({ patch: sweep(BLUE, oklab(0xffff00)), fade: { in: 400 } });
      },
      [0, 16, 100, 200, 250, 300, 500, 1000],
    );
  });
});
