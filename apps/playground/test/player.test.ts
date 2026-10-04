import { compile, FRAME } from '@pg/blits/compile';
import type { Composition } from '@pg/blits/composition';
import { CHANNELS } from '@pg/blits/kit';
import { type Columns, Player } from '@pg/blits/player';
import { subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

const c: Composition = {
  version: 1,
  title: 't',
  stage: { kind: 'dots', cols: 4, rows: 1 },
  length: 3000,
  levels: [{ name: 'k', value: 1, min: 0, max: 1 }],
  voices: [
    {
      id: 'sp',
      name: 'sp',
      hue: 0,
      start: 0,
      rate: 1,
      loop: true,
      weight: {
        code: 'slew((s, x) => (x.elapsed < 300 ? 0 : level("k")(s, x)), { riseMs: 400, fallMs: 400 })',
      },
      fade: {},
      patch: {
        kind: 'spring',
        channel: 'offset',
        opts: { to: { code: '(s) => [s.col * 20, 5]' }, from: [0, 0] },
      },
    },
  ],
};
const subjects = subjectsOf(c.stage);
const player = () => new Player(() => compile(c, subjects, { solos: true }), subjects);

/** Every channel's bits, so -0, NaN payloads and the last ulp all count. */
const bits = (cols: Columns) =>
  CHANNELS.map((k) => [...new BigUint64Array(cols[k].slice().buffer)].map((b) => b.toString(16)));

describe('Player', () => {
  it('lands on whole frames', () => {
    const p = player();
    p.seek(100);
    expect(p.t).toBe(Math.floor(100 / FRAME) * FRAME);
    p.seek(30 * FRAME);
    expect(p.t).toBe(30 * FRAME);
  });

  it('scrubbing back over a spring and a slew weight lands on the pose playback showed, to the bit', () => {
    const live = player();
    const snaps = new Map<number, string[][]>();
    const offsets = new Map<number, number[]>();
    for (let f = 0; f <= 90; f++) {
      live.seek(f * FRAME);
      if (f % 15 === 0) {
        snaps.set(f, bits(live.columns));
        offsets.set(f, [...live.columns.offset]);
      }
    }
    // The weight is still 0 at frame 15 and mid-rise at 30, the spring mid-flight.
    expect(offsets.get(15)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(offsets.get(30)?.[7]).toBeGreaterThan(0);
    expect(offsets.get(30)?.[7]).toBeLessThan(5);
    for (const f of [60, 30, 45, 15, 0]) {
      live.seek(f * FRAME);
      expect(bits(live.columns)).toEqual(snaps.get(f));
    }
    const fresh = player();
    fresh.seek(60 * FRAME);
    expect(bits(fresh.columns)).toEqual(snaps.get(60));
  });

  it('a scrub back replays a moved level at its current value', () => {
    const moved = player();
    moved.setLevel('k', 0.5);
    moved.seek(40 * FRAME);
    const want = bits(moved.columns);
    moved.seek(10 * FRAME);
    moved.seek(40 * FRAME);
    expect(bits(moved.columns)).toEqual(want);
    const still = player();
    still.seek(40 * FRAME);
    expect(bits(still.columns)).not.toEqual(want);
  });

  it('an edit to a level drops its slider move; an unchanged level keeps it', () => {
    let comp = c;
    const p = new Player(() => compile(comp, subjects, { solos: true }), subjects);
    const at = (k: number) => {
      const q = player();
      q.setLevel('k', k);
      q.seek(40 * FRAME);
      return bits(q.columns);
    };
    p.rebuild(comp.levels);
    p.setLevel('k', 0.5);
    p.seek(40 * FRAME);
    comp = { ...comp, title: 'renamed' };
    p.rebuild(comp.levels);
    expect(bits(p.columns)).toEqual(at(0.5));
    comp = { ...comp, levels: [{ name: 'k', value: 0.25, min: 0, max: 1 }] };
    p.rebuild(comp.levels);
    expect(p.moved.has('k')).toBe(false);
    expect(bits(p.columns)).toEqual(at(0.25));
    p.setLevel('k', 0.5);
    comp = { ...comp, levels: [] };
    p.rebuild(comp.levels);
    comp = { ...comp, levels: [{ name: 'k', value: 0.25, min: 0, max: 1 }] };
    p.rebuild(comp.levels);
    expect(bits(p.columns)).toEqual(at(0.25));
  });

  it('rebuild keeps the playhead and the pose', () => {
    const p = player();
    p.seek(500);
    const t = p.t;
    const want = bits(p.columns);
    p.rebuild();
    expect(p.t).toBe(t);
    expect(bits(p.columns)).toEqual(want);
  });

  it('a solo pulls one voice', () => {
    const p = player();
    p.seek(400);
    const out = Player.columnsFor(subjects.length);
    p.solo('sp', out);
    expect(bits(out)).toEqual(bits(p.columns));
  });
});
