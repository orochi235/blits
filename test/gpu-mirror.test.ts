import { describe, expect, it, vi } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import { codesOf } from '../src/gpu/eligible.js';
import { mixerOf } from '../src/gpu/engine.js';
import { Mirror } from '../src/gpu/mirror.js';
import { spanned } from '../src/gpu/mirrors.js';
import { motionPack } from '../src/gpu/runners/motion.js';
import { Timings } from '../src/gpu/timings.js';
import { unreadOf } from '../src/gpu/unread.js';
import { kit, mix, spring, sum, tween } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
import { motionOf } from '../src/motion.js';
import type { Motions } from '../src/motions.js';
import type { Voice } from '../src/voice.js';

interface C {
  id: number;
}
interface P {
  x: number;
}
const K = kit<P>({ x: sum() });

/** A spring cued on a mix at time 0, its `Motions`, and a mirror of `list` with `delays`. */
function setup(list: C[], meet: C[] = [], delays: Float64Array | null = null) {
  const s = spring<C, P>('x', { to: (c) => c.id });
  const m = mix<C, P>(K, { name: 'mirror' });
  m.sync(0);
  m.cue({ patch: s, subjects: list });
  for (const c of meet) m.probe(c);
  const motions = motionOf<C>(s) as Motions<C>;
  const packed = motionPack(s, codesOf(mixerOf(m)));
  if (packed === undefined || 'why' in packed) throw new Error('the spring did not pack');
  const mirror = new Mirror(motions, list, packed.values, delays);
  return { s, m, motions, mirror };
}

const cells = (n: number) => Array.from({ length: n }, (_, id) => ({ id }));

describe('motion mirror', () => {
  it('marks dirty exactly the rows of subjects retargeted', () => {
    const list = cells(1000);
    const { s, mirror } = setup(list);
    mirror.prepare(0, Number.POSITIVE_INFINITY);
    mirror.take();
    expect(mirror.dirtyRows()).toEqual([]);
    for (const i of [7, 412, 999]) s.to(list[i] as C, -5);
    expect(mirror.dirtyRows()).toEqual([7, 412, 999]);
    mirror.prepare(16, Number.POSITIVE_INFINITY);
    const stride = mirror.stride * 4;
    expect(mirror.take()).toEqual([7, 412, 999].map((r) => [r * stride, (r + 1) * stride]));
  });

  it('lays rows out in registration order, not the order the patch met subjects', () => {
    const list = cells(3);
    const reversed = [...list].reverse();
    const { motions, mirror } = setup(list, list);
    mirror.detach();
    const again = new Mirror(motions, reversed, mirror.values());
    again.prepare(0, Number.POSITIVE_INFINITY);
    const first = reversed[0] as C;
    const b = motions.base(motions.known(first) as number);
    const n = motions.n;
    const want = Array.from(motions.runs.subarray(b, b + motions.stride));
    want[0] = (want[0] as number) - again.anchor;
    expect(Array.from(again.rows.subarray(0, motions.stride))).toEqual(want);
    // The goal is the subject's id: row 0 heads for 2, the subject now first.
    expect(again.rows[3 + 2 * n]).toBe(first.id);
  });

  it('commits an untimed retarget no probe saw at the voice time', () => {
    const list = cells(4);
    const { s, m, motions, mirror } = setup(list);
    m.sync(100);
    s.to(list[2] as C, 50);
    const slot = motions.known(list[2] as C) as number;
    expect(motions.pending?.[slot]?.[0]?.at).toBeUndefined();
    mirror.prepare(100, Number.POSITIVE_INFINITY);
    const b = motions.base(slot);
    expect(motions.pending?.[slot]).toBeUndefined();
    expect(motions.runs[b]).toBe(100);
    expect(mirror.rows[2 * mirror.stride]).toBe(100 - mirror.anchor);
    expect(mirror.rows[2 * mirror.stride + 3 + 2 * motions.n]).toBe(50);
  });

  it("commits an untimed retarget at each subject's own time", () => {
    const list = cells(2);
    const { s, m, motions, mirror } = setup(list, [], Float64Array.of(0, 100));
    m.sync(150);
    for (const c of list) s.to(c, 50);
    mirror.prepare(150, Number.POSITIVE_INFINITY);
    const [b0, b1] = list.map((c) => motions.base(motions.known(c) as number));
    expect(motions.runs[b0 as number]).toBe(150);
    expect(motions.runs[b1 as number]).toBe(50);
    expect(mirror.rows[mirror.stride]).toBe(50 - mirror.anchor);
    // The voice's time is the one at delay 0; the kernel takes each subject's delay off.
    expect(mirror.values()[0]).toBe(150 - mirror.anchor);
  });

  it('keeps a retarget pending for a subject still inside its delay', () => {
    const list = cells(2);
    const { s, motions, mirror } = setup(list, [], Float64Array.of(0, 100));
    mirror.prepare(100, Number.POSITIVE_INFINITY);
    for (const c of list) s.to(c, 50, 80);
    const [s0, s1] = list.map((c) => motions.known(c) as number) as [number, number];
    mirror.prepare(150, Number.POSITIVE_INFINITY);
    expect(motions.pending?.[s0]).toBeUndefined();
    expect(motions.runs[motions.base(s0)]).toBe(80);
    expect(motions.pending?.[s1]?.length).toBe(1);
    expect(motions.runs[motions.base(s1)]).toBe(0);
    mirror.prepare(190, Number.POSITIVE_INFINITY);
    expect(motions.pending?.[s1]).toBeUndefined();
    expect(motions.runs[motions.base(s1)]).toBe(80);
    expect(mirror.rows[mirror.stride]).toBe(80 - mirror.anchor);
  });

  it('leaves an untimed retarget unstamped for a subject yet to start', () => {
    const list = cells(2);
    const { s, m, motions, mirror } = setup(list, [], Float64Array.of(0, 200));
    m.sync(150);
    for (const c of list) s.to(c, 50);
    const s1 = motions.known(list[1] as C) as number;
    mirror.prepare(150, Number.POSITIVE_INFINITY);
    expect(motions.pending?.[s1]?.[0]?.at).toBeUndefined();
    mirror.prepare(260, Number.POSITIVE_INFINITY);
    expect(motions.pending?.[s1]).toBeUndefined();
    expect(motions.runs[motions.base(s1)]).toBe(60);
  });

  it('commits a subject before its start at 0 where the voice holds its first frame', () => {
    const list = cells(2);
    const { s, m, motions, mirror } = setup(list, [], Float64Array.of(0, 200));
    m.sync(150);
    for (const c of list) s.to(c, 50);
    mirror.prepare(150, Number.POSITIVE_INFINITY, { holds: true });
    expect(motions.runs[motions.base(motions.known(list[1] as C) as number)]).toBe(0);
  });

  it('commits nothing for a row a live read would leave unsampled', () => {
    const list = cells(2);
    const { s, m, motions, mirror } = setup(list);
    m.sync(150);
    for (const c of list) s.to(c, 50);
    mirror.prepare(150, Number.POSITIVE_INFINITY, { unread: (row) => row === 1 });
    const s1 = motions.known(list[1] as C) as number;
    expect(motions.runs[motions.base(motions.known(list[0] as C) as number)]).toBe(150);
    expect(motions.pending?.[s1]?.[0]?.at).toBeUndefined();
  });

  it('reads a subject as unread where unreached, or at its first frame of a fade in', () => {
    const list = cells(3);
    const m = mix<C, P>(K);
    m.sync(0);
    m.cue({
      patch: tween<C, P>('x', { from: 0, to: 1, ms: 500 }),
      subjects: list.slice(0, 2),
      stagger: (c: C) => c.id * 100,
      fade: { in: 400 },
    });
    const mixer = mixerOf(m) as unknown as Mixer<C, unknown>;
    const voice = mixer.cued[0] as Voice<C, unknown>;
    const answers = new Answers(mixer);
    answers.register(list);
    m.sync(100);
    const unread = unreadOf(mixer, voice, answers, new Timings());
    expect([0, 1, 2].map(unread)).toEqual([false, true, true]);
  });

  it('keeps a retarget timed ahead pending until the frame reaching it', () => {
    const list = cells(4);
    const { s, motions, mirror } = setup(list);
    mirror.prepare(100, Number.POSITIVE_INFINITY);
    s.to(list[1] as C, 50, 600);
    const slot = motions.known(list[1] as C) as number;
    const b = motions.base(slot);
    for (const t of [116, 400, 599]) {
      mirror.prepare(t, Number.POSITIVE_INFINITY);
      expect(motions.pending?.[slot]?.length).toBe(1);
      expect(motions.runs[b]).toBe(0);
    }
    mirror.take();
    mirror.prepare(616, Number.POSITIVE_INFINITY);
    expect(motions.pending?.[slot]).toBeUndefined();
    expect(motions.runs[b]).toBe(600);
    expect(mirror.dirtyRows()).toEqual([1]);
    expect(mirror.rows[mirror.stride]).toBe(600 - mirror.anchor);
  });

  it('gives an unmet subject its first row without the patch meeting it', () => {
    const list = cells(3);
    const { s, motions, mirror } = setup(list);
    mirror.prepare(0, Number.POSITIVE_INFINITY);
    for (const c of list) expect(s.read(c)).toBeUndefined();
    expect(motions.numbers.size).toBe(0);
    const n = motions.n;
    expect(mirror.rows[mirror.stride + 3]).toBe(1);
    expect(mirror.rows[mirror.stride + 3 + 2 * n]).toBe(1);
  });

  it('reads a subject retargeted after registration from its number from then on', () => {
    const list = cells(3);
    const { s, m, motions, mirror } = setup(list);
    mirror.prepare(0, Number.POSITIVE_INFINITY);
    mirror.take();
    m.sync(100);
    s.to(list[1] as C, 50);
    expect(mirror.dirtyRows()).toEqual([1]);
    mirror.prepare(100, Number.POSITIVE_INFINITY);
    const slot = motions.known(list[1] as C) as number;
    const n = motions.n;
    expect(motions.runs[motions.base(slot)]).toBe(100);
    expect(mirror.rows[mirror.stride]).toBe(100);
    expect(mirror.rows[mirror.stride + 3 + 2 * n]).toBe(50);
    s.to(list[1] as C, 70, 300);
    mirror.prepare(300, Number.POSITIVE_INFINITY);
    expect(mirror.rows[mirror.stride]).toBe(300);
    expect(mirror.rows[mirror.stride + 3 + 2 * n]).toBe(70);
    // The others are still unmet.
    expect(motions.known(list[0] as C)).toBeUndefined();
  });

  it('takes the watch from a mirror on another mix, which takes it back and renumbers', () => {
    const list = cells(2);
    const { s, motions, mirror } = setup(list);
    mirror.prepare(0, Number.POSITIVE_INFINITY);
    mirror.take();
    const other = new Mirror(motions, list, mirror.values());
    s.to(list[0] as C, 9);
    expect(other.stirred).toBe(true);
    expect(mirror.stirred).toBe(true);
    mirror.prepare(16, Number.POSITIVE_INFINITY);
    expect(motions.listener).not.toBeNull();
    expect(mirror.take()).toEqual([[0, 2 * mirror.stride * 4]]);
    expect(mirror.rows[3 + 2 * motions.n]).toBe(9);
    s.to(list[1] as C, 4);
    expect(mirror.stirred).toBe(true);
  });

  it('warns once where another mirror took its watch, since both rebuild every frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const list = cells(2);
    const { motions, mirror } = setup(list);
    mirror.prepare(0, Number.POSITIVE_INFINITY);
    expect(warn).not.toHaveBeenCalled();
    const other = new Mirror(motions, list, mirror.values());
    mirror.prepare(16, Number.POSITIVE_INFINITY);
    other.prepare(16, Number.POSITIVE_INFINITY);
    mirror.prepare(32, Number.POSITIVE_INFINITY);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/one motion patch is folded by two voices at once/);
    warn.mockRestore();
  });

  it('hands every row over as one range when it re-anchors, each time counted from the new anchor', () => {
    const list = cells(50);
    const { s, m, motions, mirror } = setup(list, list.slice(0, 10));
    mirror.prepare(0, Number.POSITIVE_INFINITY);
    mirror.take();
    const before = Array.from(mirror.rows);
    const t = 2 ** 14 + 100;
    m.sync(t);
    s.to(list[3] as C, 1);
    mirror.prepare(t, Number.POSITIVE_INFINITY);
    expect(mirror.anchor).toBe(t);
    expect(mirror.dirtyRows()).toEqual(list.map((_, i) => i));
    expect(mirror.take()).toEqual([[0, mirror.rows.byteLength]]);
    expect(mirror.take()).toEqual([]);
    const n = motions.n;
    const st = mirror.stride;
    // Row 3 was retargeted at t: released now, heading for 1.
    expect(mirror.rows[3 * st]).toBe(0);
    expect(mirror.rows[3 * st + 3 + 2 * n]).toBe(1);
    // Every other row, met (0) or not (20), only moved its release time.
    for (const row of [0, 20]) {
      expect(mirror.rows[row * st]).toBe(-t);
      expect(Array.from(mirror.rows.subarray(row * st + 1, (row + 1) * st))).toEqual(
        before.slice(row * st + 1, (row + 1) * st),
      );
    }
  });

  it('writes one span where many runs of rows changed, and each run where few did', () => {
    const run = (k: number): [number, number] => [k * 24, k * 24 + 24];
    expect(spanned(Array.from({ length: 100 }, (_, k) => run(k * 1000)))).toBe(false);
    expect(spanned(Array.from({ length: 1000 }, (_, k) => run(k * 100)))).toBe(true);
    expect(spanned(Array.from({ length: 1000 }, (_, k) => run(k * 1000)))).toBe(false);
    expect(spanned([])).toBe(false);
  });

  it('rewrites only the rows whose number was given up or handed to another', () => {
    const list = cells(10);
    const { s, m, motions, mirror } = setup(list, list.slice(0, 9));
    mirror.prepare(0, Number.POSITIVE_INFINITY);
    mirror.take();
    const freed = motions.known(list[3] as C) as number;
    m.drop(list[3] as C);
    s.to(list[9] as C, 40);
    expect(motions.known(list[9] as C)).toBe(freed);
    mirror.prepare(16, Number.POSITIVE_INFINITY);
    const stride = mirror.stride * 4;
    expect(mirror.take()).toEqual([
      [3 * stride, 4 * stride],
      [9 * stride, 10 * stride],
    ]);
    const n = motions.n;
    expect(mirror.rows[9 * mirror.stride + 3 + 2 * n]).toBe(40);
    // Subject 3, given up, is back to the run it would start with: at rest on its goal, its id.
    expect(mirror.rows[3 * mirror.stride + 3]).toBe(3);
    expect(mirror.rows[3 * mirror.stride + 3 + 2 * n]).toBe(3);
  });

  it('stops listening once detached', () => {
    const list = cells(2);
    const { s, motions, mirror } = setup(list);
    mirror.detach();
    expect(motions.listener).toBeNull();
    s.to(list[0] as C, 9);
    expect(mirror.stirred).toBe(false);
  });
});
