import { kit, type Mix, mix, patch, sum, type Transport, transport } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { drive, Tone } from './audio.js';
import { onsets, sampleAt } from './render.js';
import { HITS, SR } from './scene.js';

interface Level {
  x: number;
}

const DUR = 4000;

/** What the host does at the first frame at or after `at`, before that frame's write. */
interface Step {
  at: number;
  /** Run before the frame's sync, as a host calls `rebase`. */
  before?: boolean;
  run(m: Mix<string, Level>, t: Transport): void;
}

/**
 * Plays a mix on a shared transport with history through the driver: `x` reads the mix's own time,
 * and a silent voice hits at `HITS` each 1 s pass. `frames` are the host's frame times; the audio
 * clock reads the same. Gives the rendered `x`, the note onsets, and the mix time each frame wrote
 * from.
 */
async function play(frames: readonly number[], steps: readonly Step[] = []) {
  const at: [number, number][] = [];
  const buffer = await Tone.Offline(
    () => {
      const x = new Tone.Signal(0);
      const merge = new Tone.Merge({ channels: 2 });
      x.connect(merge, 0, 0);
      merge.toDestination();
      const raw = Tone.getContext().rawContext;
      const t = transport({ history: { ms: 10_000, tape } });
      const m = mix<string, Level>(kit({ x: sum() }), { transport: t, name: 'history' });
      m.cue({
        patch: patch<string, Level>(DUR * 4, (p) => ({ x: p * DUR * 4 }), { writes: ['x'] }),
        start: 0,
      });
      m.cue({
        patch: patch<string, Level>(1000, () => ({}), { writes: [] }),
        start: 0,
        loop: true,
        hits: HITS.map((h) => ({ at: h, event: 'note' })),
      });
      let read = 0;
      const d = drive<string, Level, string>(m, {
        clock: () => read / 1000,
        take: (item, time) => {
          if (!('hit' in item)) return undefined;
          const src = raw.createConstantSource();
          Tone.connect(src, merge, 0, 1);
          src.start(time);
          src.stop(time + 2 / SR);
          return { cancel: () => src.disconnect() };
        },
      });
      d.attach('x', { x });
      const done = new Set<Step>();
      const run = (f: number, before: boolean) => {
        for (const s of steps)
          if (!done.has(s) && f >= s.at && (s.before ?? false) === before) {
            s.run(m, t);
            done.add(s);
          }
      };
      for (const f of frames) {
        read = f;
        run(f, true);
        t.sync(f);
        run(f, false);
        d.write();
        at.push([f, m.now]);
      }
    },
    DUR / 1000,
    2,
    SR,
  );
  return {
    x: buffer.getChannelData(0).slice(),
    notes: onsets(buffer.getChannelData(1).slice()),
    at,
  };
}

const sixty = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let f = from; f < to; f += 1000 / 60) out.push(f);
  return out;
};

/** The mix time at host time `h`, from each frame's mix time, as the mix runs at rate 1. */
const mixAt = (at: readonly [number, number][], h: number): number => {
  let k = 0;
  while (k + 1 < at.length && (at[k + 1] as [number, number])[0] <= h) k++;
  const [f, t] = at[k] as [number, number];
  return t + (h - f);
};

/** The largest gap between rendered `x` and the mix's time, each ms from `from` to `to`. */
function worst(x: Float32Array, expect: (h: number) => number, from: number, to: number): number {
  let max = 0;
  for (let h = Math.ceil(from); h < to; h++)
    max = Math.max(max, Math.abs((x[sampleAt(h)] as number) - expect(h)));
  return max;
}

/** When each note falls, host ms, for a mix whose time jumps at each `[host, mix]` given. */
function noteTimes(jumps: readonly [number, number][], end = DUR): number[] {
  const out: number[] = [];
  jumps.forEach(([from, e0], k) => {
    const to = jumps[k + 1]?.[0] ?? end;
    const eEnd = e0 + (to - from);
    for (let pass = Math.floor(e0 / 1000); pass * 1000 < eEnd; pass++)
      for (const h of HITS) {
        const e = pass * 1000 + h;
        if (e < e0 || e >= eEnd || (k > 0 && e === e0)) continue;
        out.push(from + (e - e0));
      }
  });
  return out;
}

describe('a mix on a shared transport with history', () => {
  it('replaces the curve and the notes ahead on a seek back and a seek forward', async () => {
    const steps: Step[] = [
      { at: 1500, run: (_, t) => t.seek(300) },
      { at: 2500, run: (_, t) => t.seek(1400) },
    ];
    const r = await play(sixty(0, DUR), steps);
    const back = r.at.find(([, t], k) => k > 0 && t < (r.at[k - 1] as [number, number])[1]);
    const fwd = r.at.find(([f, t]) => f > 2000 && t >= 1400);
    if (back === undefined || fwd === undefined) throw new Error('no seek');
    // Each seek's frame writes from the time sought, so none of the 150 ms booked past it plays.
    expect(worst(r.x, (h) => mixAt(r.at, h), 20, back[0] - 1)).toBeLessThan(1e-3);
    expect(worst(r.x, (h) => mixAt(r.at, h), back[0] + 1, fwd[0] - 1)).toBeLessThan(1e-3);
    expect(worst(r.x, (h) => mixAt(r.at, h), fwd[0] + 1, DUR - 1)).toBeLessThan(1e-3);
    expect(near(r.notes, noteTimes([[0, 0], back, fwd]))).toBe(true);
  });

  it('holds through a two-second frame, then jumps to where the mix is', async () => {
    const frames = [...sixty(0, 1000), ...sixty(3000, DUR)];
    const r = await play(frames);
    const last = frames.filter((f) => f < 1000).at(-1) as number;
    expect(worst(r.x, (h) => h, 20, last + 150)).toBeLessThan(1e-3);
    expect(worst(r.x, () => last + 150, last + 151, 3000)).toBeLessThan(1e-3);
    expect(worst(r.x, (h) => h, 3001, DUR - 1)).toBeLessThan(1e-3);
    // The notes the frame skips are later than `late` when first seen, so they never play.
    expect(near(r.notes, [...hits(0, last + 150), ...hits(3000, DUR)])).toBe(true);
  });

  it('picks up where the mix was after a rebase over a hidden tab', async () => {
    const frames = [...sixty(0, 1150), ...sixty(3000, DUR)];
    const last = frames.filter((f) => f < 1150).at(-1) as number;
    const gap = 3000 - last;
    const r = await play(frames, [{ at: 3000, before: true, run: (_, t) => t.rebase() }]);
    expect(worst(r.x, (h) => h, 20, last + 150)).toBeLessThan(1e-3);
    expect(worst(r.x, () => last + 150, last + 151, 3000)).toBeLessThan(1e-3);
    expect(worst(r.x, (h) => h - gap, 3001, DUR - 1)).toBeLessThan(1e-3);
    // What was read ahead before the tab hid played into the gap: the curve ran on to 150 ms past
    // where the mix resumes, and the note at 1250 sounded then and does not sound again.
    const after = hits(last + 150, DUR - gap).map((e) => e + gap);
    expect(near(r.notes, [...hits(0, last + 150), ...after])).toBe(true);
  });
});

/** Where the notes voice hits from mix time `from` up to `to`, ms. */
function hits(from: number, to: number): number[] {
  const out: number[] = [];
  for (let pass = 0; pass * 1000 < to; pass++)
    for (const h of HITS)
      if (pass * 1000 + h >= from && pass * 1000 + h < to) out.push(pass * 1000 + h);
  return out;
}

/** Whether each note heard is within a sample of the one expected, and none is missing. */
const near = (heard: readonly number[], truth: readonly number[]): boolean =>
  heard.length === truth.length &&
  heard.every((n, i) => Math.abs(n - (truth[i] as number)) <= 1000 / SR + 1e-9);
