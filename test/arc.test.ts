import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Mix, MixOptions } from '../src/types.js';

interface Pose {
  a: number;
  b: number;
  c: number;
}
const K = kit<Pose>({ a: sum(), b: sum(), c: sum() });
interface Row {
  id: string;
}
type M = Mix<Row, Pose>;
const r = { id: 'r' };

/** Writes 1 to one channel, so a probe of it reads that part's weight. */
const part = (ch: keyof Pose, ms: number) =>
  patch<Row, Pose>(ms, () => ({ [ch]: 1 }) as Partial<Pose>, { writes: [ch] });

const at = (m: M, t: number) => {
  m.sync(t);
  const p = m.probe(r);
  return [p.a, p.b, p.c].map((v) => Math.round(v * 1000) / 1000);
};

const marksOf = (m: M, name: string) =>
  Object.fromEntries(
    m
      .marks(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)
      .filter((e) => e.name === name)
      .map((e) => [e.mark, Math.round(e.timestamp * 1000) / 1000]),
  );

const make = (opts: MixOptions = {}) => {
  const m = mix<Row, Pose>(K, opts);
  m.sync(0);
  return m;
};

describe('arcs', () => {
  it('hands over enter, active and exit in order, and leaves at the end of its exit', async () => {
    const m = make();
    const h = m.arc({
      name: 'word',
      enter: { patch: part('a', 200) },
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 300) },
      hold: 500,
    });
    expect(at(m, 100)).toEqual([1, 0, 0]);
    expect(at(m, 250)).toEqual([0, 1, 0]);
    expect(at(m, 650)).toEqual([0, 1, 0]);
    expect(at(m, 750)).toEqual([0, 0, 1]);
    expect(marksOf(m, 'word')).toEqual({ start: 0, in: 200, coast: 700, out: 700, end: 1000 });
    at(m, 999);
    expect(h.state).not.toBe('done');
    at(m, 1001);
    expect(h.state).toBe('done');
    await expect(h.played).resolves.toBe(true);
    await h.done;
  });

  it('crossfades across each boundary over the blend, half before and half after', () => {
    const m = make();
    m.arc({
      enter: { patch: part('a', 200) },
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 300) },
      hold: 500,
      blend: 100,
    });
    expect(at(m, 150)).toEqual([1, 0, 0]);
    expect(at(m, 175)).toEqual([0.75, 0.25, 0]);
    expect(at(m, 200)).toEqual([0.5, 0.5, 0]);
    expect(at(m, 225)).toEqual([0.25, 0.75, 0]);
    expect(at(m, 700)).toEqual([0, 0.5, 0.5]);
    // The arc ends at full weight: no ramp down past its own end.
    expect(at(m, 990)).toEqual([0, 0, 1]);
  });

  it('keeps the three ramps summing to no more than 1 under a hold shorter than the blend', () => {
    const m = make();
    m.arc({
      enter: { patch: part('a', 200) },
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 300) },
      hold: 20,
      blend: 100,
    });
    const [a = 0, b = 0, c = 0] = at(m, 210);
    expect(a + b + c).toBeCloseTo(1, 2);
    expect(b).toBeGreaterThan(0);
  });

  it('loops the active for the hold, and plays its own length without one', () => {
    const m = make();
    const seen: number[] = [];
    const phased = patch<Row, Pose>(100, (phase) => ({ b: phase }), { writes: ['b'] });
    m.arc({ name: 'x', active: { patch: phased }, hold: 250 });
    for (const t of [50, 150, 240]) seen.push(at(m, t)[1] as number);
    expect(seen).toEqual([0.5, 0.5, 0.4]);
    expect(marksOf(m, 'x')).toMatchObject({ in: 0, coast: 250, end: 250 });

    const n = make();
    n.arc({ name: 'y', active: { patch: phased, loop: 3 } });
    expect(marksOf(n, 'y')).toMatchObject({ coast: 300, end: 300 });
  });

  it('leaves a part it lacks to the one before, which holds its last frame', () => {
    const m = make();
    const ramp = patch<Row, Pose>(100, (phase) => ({ a: phase }), { writes: ['a'] });
    m.arc({ name: 'w', enter: { patch: ramp }, exit: { patch: part('c', 100) }, hold: 300 });
    expect(at(m, 50)).toEqual([0.5, 0, 0]);
    expect(at(m, 250)).toEqual([1, 0, 0]);
    expect(at(m, 450)).toEqual([0, 0, 1]);
    expect(marksOf(m, 'w')).toMatchObject({ in: 100, coast: 400, out: 400, end: 500 });
  });

  it('layers several voices in a part, which lasts as long as the longest', () => {
    const m = make();
    m.arc({
      name: 'l',
      enter: [{ patch: part('a', 100) }, { patch: part('b', 300) }],
      exit: { patch: part('c', 100) },
    });
    expect(at(m, 50)).toEqual([1, 1, 0]);
    expect(at(m, 200)).toEqual([1, 1, 0]);
    expect(marksOf(m, 'l')).toMatchObject({ in: 300, out: 300, end: 400 });
  });

  it('takes a part’s duration over its patch’s, for a stagger the patch does not know', () => {
    const m = make();
    m.arc({
      name: 's',
      enter: { patch: part('a', 100), stagger: () => 50, duration: 150 },
      exit: { patch: part('c', 100) },
    });
    expect(marksOf(m, 's')).toMatchObject({ in: 150, end: 250 });
  });

  it('holds open until released, its later marks unknown until then', async () => {
    const m = make();
    const h = m.arc({
      name: 'o',
      enter: { patch: part('a', 100) },
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 200) },
      hold: 'open',
      blend: 40,
    });
    at(m, 5000);
    expect(marksOf(m, 'o')).toEqual({ start: 0, in: 100 });
    expect(at(m, 5000)).toEqual([0, 1, 0]);
    h.release();
    // The exit begins half a blend on, and the blend into it starts now.
    expect(marksOf(m, 'o')).toEqual({ start: 0, in: 100, coast: 5020, out: 5020, end: 5220 });
    expect(at(m, 5020)).toEqual([0, 0.5, 0.5]);
    expect(at(m, 5100)).toEqual([0, 0, 1]);
    at(m, 5300);
    await expect(h.done).resolves.toBeUndefined();
    await expect(h.played).resolves.toBe(true);
  });

  it('releases into the exit straight after an enter still playing', () => {
    const m = make();
    const h = m.arc({
      name: 'e',
      enter: { patch: part('a', 300) },
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 100) },
      hold: 'open',
    });
    at(m, 100);
    h.release();
    expect(marksOf(m, 'e')).toMatchObject({ in: 300, out: 300, end: 400 });
  });

  it('cuts a finite hold short on release, and ignores one after the exit began', () => {
    const m = make();
    const h = m.arc({
      name: 'f',
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 100) },
      hold: 1000,
    });
    at(m, 400);
    h.release();
    expect(marksOf(m, 'f')).toMatchObject({ out: 400, end: 500 });
    at(m, 450);
    h.release();
    expect(marksOf(m, 'f')).toMatchObject({ out: 400, end: 500 });
  });

  it('leaves with no exit when faded, and done still resolves', async () => {
    const m = make();
    const h = m.arc({
      name: 'q',
      enter: { patch: part('a', 100) },
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 100) },
      hold: 'open',
    });
    at(m, 200);
    h.fade({ over: 50 });
    expect(marksOf(m, 'q')).toMatchObject({ out: 200, end: 250 });
    expect(marksOf(m, 'q').coast).toBeUndefined();
    expect(at(m, 225)).toEqual([0, 0.5, 0]);
    at(m, 251);
    expect(h.state).toBe('done');
    await expect(h.done).resolves.toBeUndefined();
    await expect(h.played).resolves.toBe(false);
  });

  it('places another voice by its marks', () => {
    const m = make();
    m.arc({
      name: 'JACKPOT',
      enter: { patch: part('a', 250) },
      active: { patch: part('b', 100) },
      hold: 500,
    });
    m.cue({
      name: 'flash',
      patch: part('c', 50),
      anchor: { start: { of: 'JACKPOT', mark: 'in' } },
    });
    expect(marksOf(m, 'flash')).toMatchObject({ start: 250 });
  });

  it('books its marks, the ones release fixes once it has', () => {
    const m = make();
    let now = 0;
    const got: string[] = [];
    m.book({
      clock: () => now,
      ahead: 50,
      late: 50,
      take: (item) => {
        if ('mark' in item && item.name === 'b') got.push(`${item.mark}@${item.timestamp}`);
        return undefined;
      },
    });
    const h = m.arc({
      name: 'b',
      enter: { patch: part('a', 100) },
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 100) },
      hold: 'open',
    });
    const run = (to: number) => {
      for (; now <= to; now += 16) m.sync(now);
    };
    run(200);
    expect(got).toEqual(['start@0', 'in@100']);
    h.release();
    run(400);
    expect(got).toEqual(['start@0', 'in@100', 'coast@192', 'out@192', 'end@292']);
  });

  it('queues in a span, one after another', () => {
    const m = make();
    const s = m.span({ name: 'program' });
    for (const name of ['one', 'two'])
      m.arc({
        name,
        owner: s,
        enter: { patch: part('a', 100) },
        active: { patch: part('b', 100) },
        exit: { patch: part('c', 100) },
        hold: 200,
        blend: 20,
      });
    expect(marksOf(m, 'one')).toMatchObject({ start: 0, end: 400 });
    expect(marksOf(m, 'two')).toMatchObject({ start: 400, in: 500, out: 700, end: 800 });
    expect(marksOf(m, 'program')).toMatchObject({ end: 800 });
    expect(at(m, 450)).toEqual([1, 0, 0]);
    expect(at(m, 650)).toEqual([0, 1, 0]);
  });

  it('refuses an open hold in a span, an exit that never ends, and a backward cue', () => {
    const m = make();
    const s = m.span({});
    expect(() => m.arc({ owner: s, active: { patch: part('b', 100) }, hold: 'open' })).toThrow(
      /held open/,
    );
    expect(() => m.arc({ exit: { patch: part('c', 100), loop: true } })).toThrow(/exit has to end/);
    expect(() => m.arc({ active: { patch: part('b', 100) }, rate: -1 })).toThrow(/backward/);
  });

  it('reads the same on lanes and off', () => {
    const run = (lanes: boolean) => {
      const m = make({ lanes });
      m.arc({
        enter: { patch: part('a', 200) },
        active: { patch: part('b', 100) },
        exit: { patch: part('c', 300) },
        hold: 300,
        blend: 80,
      });
      return [0, 170, 200, 230, 480, 500, 520, 800].map((t) => at(m, t));
    };
    expect(run(true)).toEqual(run(false));
  });

  it('seeks back to before a release and plays it again', () => {
    const m = make({ history: { ms: 10_000, tape } });
    const h = m.arc({
      name: 'z',
      enter: { patch: part('a', 100) },
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 100) },
      hold: 'open',
    });
    at(m, 300);
    h.release();
    at(m, 350);
    expect(marksOf(m, 'z')).toMatchObject({ out: 300, end: 400 });
    m.seek(200);
    expect(marksOf(m, 'z').out).toBeUndefined();
    // The host's clock runs on from 350, 150 ms ahead of the mix's.
    expect(at(m, 400)).toEqual([0, 1, 0]);
    expect(at(m, 500)).toEqual([0, 0, 1]);
    expect(marksOf(m, 'z')).toMatchObject({ out: 450, end: 550 });
  });

  it('reads ahead across a release the tape holds', () => {
    const m = make({ history: { ms: 10_000, tape } });
    const h = m.arc({
      enter: { patch: part('a', 100) },
      active: { patch: part('b', 100) },
      exit: { patch: part('c', 100) },
      hold: 'open',
    });
    at(m, 300);
    h.release();
    at(m, 316);
    m.seek(200);
    const p = m.project(350).probe(r);
    expect([p.a, p.b, p.c]).toEqual([0, 0, 1]);
  });
});
