import { color, type Handle, keys, kit, type Mix, mix, mul, oklab, sum } from '@msb235/blits';
import { rng } from '@stress/rng';
import { createHistory as tape } from '@weasel-js/history';

export interface Pose {
  x: number;
  opacity: number;
  tint: number[];
}
export interface Clip {
  i: number;
}

export const FRAME_MS = 1000 / 60;
export const SEQUENCES = 10;
export const SCENES = 3;
export const PER_SIZE = 10;
export const SEQ_MS = 6000;
export const END = SEQUENCES * SEQ_MS;
export const HISTORY_MS = 60_000;
/** The tracer runs far past `END`, so it reads the reel's clock wherever the editor takes it. */
const TRACE_MS = END * 20;
const PALETTE = [0xd94f3d, 0x3d7dd9, 0x5bbf6a, 0xe8b33c, 0x9a5fd0].map(oklab);

const LAYER = kit<Pose>({ x: sum(), opacity: mul(), tint: color() });

export interface Timeline {
  m: Mix<Clip, Pose>;
  /** The owner every sequence plays under; the editor turns it back to play in reverse. */
  reel: Handle<Clip>;
  clips: Clip[];
  /** A subject whose `x` is the reel's clock. */
  tracer: Clip;
  x: Float64Array;
  opacity: Float64Array;
  tint: Float64Array;
}

function clipPatch(seed: number, i: number) {
  const r = rng(seed * 7919 + i);
  const ms = 400 + r.int(1200);
  const x0 = r.next() * 1000;
  const x1 = x0 + (r.next() - 0.5) * 400;
  const c0 = PALETTE[r.int(PALETTE.length)] as number[];
  const c1 = PALETTE[r.int(PALETTE.length)] as number[];
  const mid = c0.map((v, k) => (v + (c1[k] as number)) / 2);
  return keys<Clip, Pose>(
    ms,
    [
      { at: 0, delta: { x: x0, opacity: 0, tint: c0 } },
      { at: 0.15, delta: { x: x0 + (x1 - x0) * 0.15, opacity: 1, tint: mid } },
      { at: 0.85, delta: { x: x0 + (x1 - x0) * 0.85, opacity: 1, tint: mid } },
      { at: 1, delta: { x: x1, opacity: 0, tint: c1 } },
    ],
    { ease: 'linear' },
  );
}

/** Ten sequences of three scenes of clips, each clip its own layer, all under one reel. */
export function build(seed: number, size: number, lanes: boolean | undefined): Timeline {
  const perScene = Math.max(1, Math.round(size * PER_SIZE));
  const n = SEQUENCES * SCENES * perScene;
  const clips: Clip[] = Array.from({ length: n }, (_, i) => ({ i }));
  const tracer: Clip = { i: -1 };
  const m = mix<Clip, Pose>(LAYER, {
    name: 'timeline',
    lanes,
    history: { ms: HISTORY_MS, tape },
  });
  const reel = m.owns({ start: 0, name: 'reel' });
  m.cue({
    owner: reel,
    patch: keys<Clip, Pose>(
      TRACE_MS,
      [
        { at: 0, delta: { x: 0 } },
        { at: 1, delta: { x: TRACE_MS } },
      ],
      { ease: 'linear' },
    ),
    subjects: [tracer],
    loop: false,
    start: 0,
    freeze: 'both',
    name: 'tracer',
  });
  let c = 0;
  for (let q = 0; q < SEQUENCES; q++) {
    const seq = m.span({
      owner: reel,
      start: q * SEQ_MS,
      duration: SEQ_MS,
      order: 'queue',
      name: `seq${q}`,
    });
    for (let s = 0; s < SCENES; s++) {
      const scene = m.span({
        owner: seq,
        duration: SEQ_MS / SCENES,
        order: 'stagger',
        share: 0.5,
        name: `scene${s}`,
      });
      for (let k = 0; k < perScene; k++, c++) {
        m.cue({
          owner: scene,
          patch: clipPatch(seed, c),
          subjects: [clips[c] as Clip],
          loop: false,
          faster: 3,
          slower: 3,
        });
      }
    }
  }
  return {
    m,
    reel,
    clips,
    tracer,
    x: new Float64Array(n),
    opacity: new Float64Array(n),
    tint: new Float64Array(n * 4),
  };
}

/** Writes every clip's pose into `out`: all `x`, then all `opacity`, then four `tint` numbers each. */
export function readInto(t: Timeline, out: Float64Array): void {
  t.m.pull(t.clips, { x: t.x, opacity: t.opacity, tint: t.tint });
  out.set(t.x, 0);
  out.set(t.opacity, t.clips.length);
  out.set(t.tint, t.clips.length * 2);
}

/** Names the clip and channel a position in `readInto`'s output belongs to. */
export function where(n: number, k: number): { clip: number; field: string } {
  if (k < n) return { clip: k, field: 'x' };
  if (k < n * 2) return { clip: k - n, field: 'opacity' };
  const j = k - n * 2;
  return { clip: Math.floor(j / 4), field: `tint[${j % 4}]` };
}

export function playhead(t: Timeline, pose: Pose): number {
  t.m.probe(t.tracer, pose);
  return pose.x;
}
