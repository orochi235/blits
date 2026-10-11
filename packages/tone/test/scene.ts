import { type Handle, keys, kit, type Mix, mix, mul, patch, sum } from '@msb235/blits';

export interface Pose {
  freq: number;
  gain: number;
}

export const SR = 48000;
/** How long a scene plays, ms. */
export const DUR = 4000;
export const SUBJECT = 'tone';
/** Where the notes voice's hits sit in its 1 s pass, voice ms. */
export const HITS = [0, 250, 500, 750];

export type Handles = Record<'sweep' | 'swell' | 'notes', Handle<string>>;

/** Something the host does mid-flight, at the first frame at or after `at`. */
export interface Act {
  at: number;
  run(m: Mix<string, Pose>, h: Handles): void;
}

export const make = (): Mix<string, Pose> => mix<string, Pose>(kit({ freq: sum(), gain: mul() }));

/** A 2 s sweep from 200 to 800 Hz and back, a sine swell on gain, and a silent voice of hits. */
export function scene(m: Mix<string, Pose>, start = 0): Handles {
  return {
    sweep: m.cue({
      patch: keys<string, Pose>(2000, [
        { at: 0, delta: { freq: 200 } },
        { at: 0.5, delta: { freq: 800 }, ease: 'ease-in-out' },
        { at: 1, delta: { freq: 200 } },
      ]),
      start,
    }),
    swell: m.cue({
      patch: patch<string, Pose>(1000, (p) => ({ gain: 0.5 + 0.5 * Math.sin(2 * Math.PI * p) }), {
        writes: ['gain'],
      }),
      start,
    }),
    notes: m.cue({
      patch: patch<string, Pose>(1000, () => ({}), { writes: [] }),
      start,
      hits: HITS.map((at) => ({ at, event: 'note' })),
    }),
  };
}

/** 60 fps with ±1.5 ms of jitter, a 120 ms stall at 1 s, and a 200 ms one at 3.2 s. */
export function frameTimes(): number[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  const out: number[] = [];
  const stalls = [
    { at: 1000, gap: 120, done: false },
    { at: 3200, gap: 200, done: false },
  ];
  for (let f = 0; f < DUR; ) {
    out.push(f);
    let gap = 1000 / 60 + rand() * 1.5;
    for (const s of stalls)
      if (!s.done && f >= s.at) {
        gap = s.gap;
        s.done = true;
      }
    f += gap;
  }
  return out;
}

/**
 * The mix's own pose each ms, with each act made at the frame the live run made it at. `skew` is
 * how far the host's clock reads past the scene's.
 */
export function reference(acts: readonly Act[], done: readonly number[], skew = 0): Pose[] {
  const m = make();
  const h = scene(m, skew);
  const poses: Pose[] = [];
  const run = (c: number) => acts[done.indexOf(c)]?.run(m, h);
  for (let t = 0; t < DUR; t++) {
    for (const c of done)
      if (c > t - 1 && c < t) {
        m.sync(c + skew);
        run(c);
      }
    m.sync(t + skew);
    for (const c of done) if (c === t) run(c);
    poses.push({ ...m.probe(SUBJECT) });
  }
  return poses;
}

/** A stretch of the notes voice's clock: from scene time `from` it reads `e0`, at `rate`. */
export interface Segment {
  from: number;
  e0: number;
  rate: number;
  /** It starts at a seek, and a hit exactly where a seek lands is not one the voice passes. */
  sought?: boolean;
}

/** When each note should sound, scene ms. */
export function hitTimes(segments: readonly Segment[]): number[] {
  const out: number[] = [];
  segments.forEach((s, k) => {
    const to = segments[k + 1]?.from ?? DUR;
    const eEnd = s.e0 + (to - s.from) * s.rate;
    for (let pass = Math.floor(s.e0 / 1000); pass * 1000 < eEnd; pass++)
      for (const at of HITS) {
        const e = pass * 1000 + at;
        if (e < s.e0 || e >= eEnd || (s.sought && e === s.e0)) continue;
        out.push(s.from + (e - s.e0) / s.rate);
      }
  });
  return out;
}
