import { compile, FRAME } from '@pg/blits/compile';
import type { Composition } from '@pg/blits/composition';
import { CHANNELS } from '@pg/blits/kit';
import { type Columns, Player, WINDOW } from '@pg/blits/player';
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

  it('a player taking over keeps the playhead and moves, unless the level was edited', () => {
    const old = new Player(() => compile(c, subjects), subjects, { levels: c.levels });
    old.setLevel('k', 0.5);
    old.seek(40 * FRAME);
    const same = new Player(() => compile(c, subjects), subjects, { levels: c.levels, from: old });
    expect(same.t).toBe(old.t);
    expect(same.moved.get('k')).toBe(0.5);
    expect(bits(same.columns)).toEqual(bits(old.columns));
    const levels = [{ name: 'k', value: 0.25, min: 0, max: 1 }];
    const edited = new Player(() => compile(c, subjects), subjects, { levels, from: old });
    expect(edited.moved.has('k')).toBe(false);
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

  it('a live mix rate reaches the full mix and every solo, until a rebuild', () => {
    const p = player();
    p.seek(100);
    p.liveMix((m) => {
      m.rate = 0.5;
    });
    expect(p.livened).toBe(true);
    expect(p.built.mix.rate).toBe(0.5);
    for (const m of p.built.solos.values()) expect(m.rate).toBe(0.5);
    p.rebuild(c.levels);
    expect(p.built.mix.rate).toBe(1);
  });

  it('a solo pulls one voice', () => {
    const p = player();
    p.seek(400);
    const out = Player.columnsFor(subjects.length);
    p.solo('sp', out);
    expect(bits(out)).toEqual(bits(p.columns));
  });

  it('a live retarget reaches the full mix and the solo, and a seek back or a rebuild drops it', () => {
    const p = player();
    p.seek(1500);
    const plain = player();
    plain.seek(1500);
    const before = [...p.columns.offset];
    p.live('sp', (_, patch) => {
      for (const s of subjects)
        (patch as unknown as { to(s: unknown, v: number[]): void }).to(s, [0, 80]);
    });
    expect(p.livened).toBe(true);
    p.seek(2500);
    plain.seek(2500);
    expect(p.columns.offset[1]).toBeGreaterThan(40);
    const solo = Player.columnsFor(subjects.length);
    p.solo('sp', solo);
    expect(bits(solo)).toEqual(bits(p.columns));
    p.seek(1500);
    expect(p.livened).toBe(false);
    expect([...p.columns.offset]).toEqual(before);
    p.live('sp', (h) => {
      h.weight = 0;
    });
    p.rebuild();
    expect(p.livened).toBe(false);
    p.seek(2500);
    expect(bits(p.columns)).toEqual(bits(plain.columns));
  });

  it('a live fade reaches the voice in every solo, so one anchored to its end starts there too', () => {
    const keysVoice = (id: string, delta: Record<string, number>) => ({
      id,
      name: id,
      hue: 0,
      start: 0,
      rate: 1,
      loop: true as const,
      weight: 1,
      fade: { out: 300 },
      patch: { kind: 'keys' as const, period: 1000, stops: [{ at: 0, delta }] },
    });
    const comp: Composition = {
      ...c,
      levels: [],
      voices: [
        keysVoice('b', { turn: 30 }),
        { ...keysVoice('x', { glow: 0.7 }), anchor: { start: { after: 'b' } } },
      ],
    };
    const p = new Player(() => compile(comp, subjects, { solos: true }), subjects);
    p.seek(500);
    p.live('b', (h) => h.fade());
    p.seek(1500);
    const solo = Player.columnsFor(subjects.length);
    p.solo('x', solo);
    expect(p.columns.glow[0]).toBeGreaterThan(0);
    expect(bits({ ...solo, turn: p.columns.turn })).toEqual(bits(p.columns));
  });

  it('records the picked subject through play, a seek back and a rebuild, keeping the last window', () => {
    const p = player();
    const seen: number[] = [];
    const stop = p.subscribe(() => seen.push(p.getSnapshot().samples.length));
    p.pick(1);
    p.seek(4000);
    const h = p.getSnapshot();
    expect(h.picked).toBe(1);
    expect(h.samples[h.samples.length - 1]?.t).toBe(p.t);
    expect((h.samples[0]?.t ?? 0) >= p.t - WINDOW).toBe(true);
    const last = h.samples[h.samples.length - 1];
    expect(last?.solos.get('sp')?.offset).toEqual(last?.full.offset);
    expect(last?.weights.get('sp')).toBeGreaterThan(0);
    p.seek(1000);
    expect(p.getSnapshot().samples.length).toBe(Math.floor(1000 / FRAME + 1e-9) + 1);
    const before = p.getSnapshot();
    p.rebuild();
    expect(p.getSnapshot()).not.toBe(before);
    expect(p.getSnapshot().samples.map((x) => x.full.offset)).toEqual(
      before.samples.map((x) => x.full.offset),
    );
    stop();
    expect(seen.length).toBeGreaterThan(2);
  });
});
