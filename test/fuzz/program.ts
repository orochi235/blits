import { createHistory as tape } from '@weasel-js/history';
import { kit, mul, sum } from '../../src/channels.js';
import { mix } from '../../src/mixer.js';
import { keys, patch } from '../../src/patch.js';
import type { Handle, Mark, Mix, MixOptions, VoiceSpec } from '../../src/types.js';

interface Pose {
  x: number;
  gain: number;
}
interface Part {
  id: string;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
const subjects: Part[] = [{ id: 'a' }, { id: 'b' }];

const wave = patch<Part, Pose>(400, (p) => ({ x: Math.sin(p * 2 * Math.PI) * 10 }), {
  writes: ['x'],
});
const ramp = keys<Part, Pose>(300, [
  { at: 0, delta: { gain: 1 } },
  { at: 1, delta: { gain: 0.2 } },
]);
// Integrates by explicit Euler, so its value depends on how it is stepped.
const drift = () =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
    pack: (s) => ({ ...s }),
    unpack: (d) => ({ ...(d as { x: number }) }),
  });

export interface ProgramOptions {
  anchors?: boolean;
  stateful?: boolean;
  mixRate?: boolean;
  /** Whether handles seek. Default true. */
  hseek?: boolean;
}

/** One host call, made right after the sync at host time `at`. */
export interface Op {
  at: number;
  desc: string;
  run: (m: Mix<Part, Pose>, h: Handle<Part>[]) => void;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** The host calls of one random program: cues and handle calls every 32 ms up to 640. */
export function program(seed: number, opts: ProgramOptions = {}): Op[] {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
  const ops: Op[] = [];
  let n = 0;
  for (let t = 0; t <= 640; t += 32) {
    const k = Math.floor(r() * 3);
    for (let j = 0; j < k; j++) {
      const kind = r();
      if (kind < 0.45 || n === 0) {
        const i = n++;
        const pk = pick(opts.stateful ? ['wave', 'ramp', 'drift'] : ['wave', 'ramp']);
        const loop = pick<boolean | number>([true, false, 2]);
        const fade = { in: pick([0, 50, 120]), out: pick([0, 60, 150]) };
        const freeze = pick([undefined, 'after', 'before', 'both'] as const);
        const weight = pick([1, 0.5]);
        const rate = pick([1, 1, 2, 0.5]);
        const startOff = pick([undefined, 0, 48, 100, -30]);
        const anchor =
          opts.anchors && i > 0 && r() < 0.4
            ? {
                prev: Math.floor(r() * i),
                how: pick(['after', 'with', 'out', 'in'] as const),
                by: pick([0, 40, -20]),
              }
            : null;
        const desc = `cue#${i} ${pk} loop=${loop} fade=${JSON.stringify(fade)} freeze=${freeze} w=${weight} rate=${rate} start=${startOff} anchor=${JSON.stringify(anchor)}`;
        ops.push({
          at: t,
          desc,
          run: (m, h) => {
            const spec: VoiceSpec<Part, Pose> = {
              patch: pk === 'wave' ? wave : pk === 'ramp' ? ramp : drift(),
              loop,
              fade,
              weight,
              rate,
              name: `v${i}`,
            };
            if (freeze) spec.freeze = freeze;
            if (anchor) {
              const of = `v${anchor.prev}`;
              const { how, by } = anchor;
              spec.anchor = {
                start:
                  how === 'after'
                    ? { after: of, by }
                    : how === 'with'
                      ? { with: of, by }
                      : { of, mark: how satisfies Mark, by },
              };
            } else if (startOff !== undefined) spec.start = m.now + startOff;
            h[i] = m.cue(spec);
          },
        });
        continue;
      }
      const tgt = Math.floor(r() * n);
      const what = r();
      if (what < 0.2) {
        const v = pick([0, 0.5, 1, 2, 3]);
        ops.push({ at: t, desc: `h${tgt}.rate=${v}`, run: (_m, h) => setRate(h[tgt], v) });
      } else if (what < 0.35) {
        const v = pick([0.2, 0.7, 1]);
        ops.push({ at: t, desc: `h${tgt}.weight=${v}`, run: (_m, h) => setWeight(h[tgt], v) });
      } else if (what < 0.55) {
        const over = pick([0, 80, 200]);
        const by = pick([undefined, 50, -40]);
        ops.push({
          at: t,
          desc: `h${tgt}.fade(over=${over},at=+${by})`,
          run: (m, h) => h[tgt]?.fade(by === undefined ? { over } : { over, at: m.now + by }),
        });
      } else if (what < 0.7) {
        const over = pick([0, 60, 150]);
        ops.push({ at: t, desc: `h${tgt}.rise(${over})`, run: (_m, h) => h[tgt]?.rise({ over }) });
      } else if (what < 0.8) {
        const to = pick([0, 0.5, 2]);
        const over = pick([0, 100]);
        ops.push({
          at: t,
          desc: `h${tgt}.ramp(${to},${over})`,
          run: (_m, h) => h[tgt]?.ramp(to, over),
        });
      } else if (what < 0.9 && opts.hseek !== false) {
        const e = pick([0, 100, 350, 800]);
        ops.push({ at: t, desc: `h${tgt}.seek(${e})`, run: (_m, h) => h[tgt]?.seek(e) });
      } else if (opts.mixRate) {
        const v = pick([0.5, 1, 2, 0]);
        ops.push({
          at: t,
          desc: `mix.rate=${v}`,
          run: (m) => {
            m.rate = v;
          },
        });
      }
    }
  }
  return ops;
}

function setRate(h: Handle<Part> | undefined, v: number) {
  if (h) h.rate = v;
}
function setWeight(h: Handle<Part> | undefined, v: number) {
  if (h) h.weight = v;
}

const probes = (m: { probe(s: Part): Pose }) =>
  subjects.flatMap((s) => {
    const p = m.probe(s);
    return [p.x, p.gain];
  });

/** Largest difference between two pose readings; NaN against a number is Infinity. */
function diff(a: number[] | undefined, b: number[] | undefined) {
  if (!a || !b) return Number.NaN;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (Number.isNaN(x) !== Number.isNaN(y)) return Number.POSITIVE_INFINITY;
    if (!Number.isNaN(x)) d = Math.max(d, Math.abs(x - y));
  }
  return d;
}
// Written so that NaN (a missing frame) also counts as a failure.
const differs = (a: number[] | undefined, b: number[] | undefined) => !(diff(a, b) <= 1e-9);

const every = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to; t += step) out.push(t);
  return out;
};

/** Plays a program at host times `frames`, recording the poses and mix time after each frame's calls. */
export function play(ops: Op[], frames: number[], opts: MixOptions) {
  const m = mix<Part, Pose>(K, opts);
  const h: Handle<Part>[] = [];
  const poses = new Map<number, number[]>();
  const mixT = new Map<number, number>();
  for (const t of frames) {
    m.sync(t);
    for (const op of ops) {
      if (op.at !== t) continue;
      // A call the mix refuses is refused the same way in every run, so it is not a failure here.
      try {
        op.run(m, h);
      } catch {}
    }
    poses.set(t, probes(m));
    mixT.set(t, m.now);
  }
  return { m, poses, mixT };
}

const frames = every(0, 1600, 16);
const kept = (): MixOptions => ({ history: { ms: 100000, every: 50, tape }, stepMs: 4 });
const fmt = (xs: number[] | undefined) => (xs ? xs.map((x) => +x.toFixed(6)).join(',') : 'none');

export type Property = 'seek' | 'behind' | 'ahead' | 'dt';

/** The host frames each property checks at; `dt` checks every frame. */
export const checkedAt: Record<Property, number[]> = {
  seek: [96, 320, 512, 704],
  behind: [64, 160, 320, 480, 640],
  ahead: [672, 800, 1008, 1408],
  dt: [0],
};

/** Plays straight through to `last`, seeks back to the mix time of frame `t`, and plays on. */
function seekThenPlay(ops: Op[], ref: ReturnType<typeof play>, t: number): string | null {
  const run = play(ops, frames, kept());
  run.m.seek(ref.mixT.get(t) as number);
  if (differs(probes(run.m), ref.poses.get(t)))
    return `seek(${t}) got ${fmt(probes(run.m))} want ${fmt(ref.poses.get(t))}`;
  const last = frames[frames.length - 1] as number;
  for (const f of frames) {
    if (f <= t) continue;
    run.m.sync(last + (f - t));
    if (differs(probes(run.m), ref.poses.get(f)))
      return `seek(${t}) then frame ${f} got ${fmt(probes(run.m))} want ${fmt(ref.poses.get(f))}`;
  }
  return null;
}

function checkOne(prop: Property, ops: Op[], t: number, ref: () => ReturnType<typeof play>) {
  switch (prop) {
    case 'seek':
      return seekThenPlay(ops, ref(), t);
    case 'behind': {
      const r = ref();
      const got = probes(r.m.project(r.mixT.get(t) as number));
      return differs(got, r.poses.get(t))
        ? `project(${t}) behind got ${fmt(got)} want ${fmt(r.poses.get(t))}`
        : null;
    }
    case 'ahead': {
      const r = ref();
      // Every call is made by 640, so a run stopped at 656 has all of them.
      const early = play(
        ops,
        frames.filter((f) => f <= 656),
        kept(),
      );
      const got = probes(early.m.project(r.mixT.get(t) as number));
      return differs(got, r.poses.get(t))
        ? `project(${t}) from 656 got ${fmt(got)} want ${fmt(r.poses.get(t))}`
        : null;
    }
    case 'dt': {
      const a = play(ops, frames, { stepMs: 4 });
      const at = new Set([
        ...frames.filter((f) => f % 32 === 0 || f % 48 === 0),
        ...ops.map((o) => o.at),
      ]);
      const sparse = [...at].sort((x, y) => x - y);
      const b = play(ops, sparse, { stepMs: 4 });
      for (const f of sparse)
        if (differs(b.poses.get(f), a.poses.get(f)))
          return `frame ${f} at 32/48 ms got ${fmt(b.poses.get(f))}, at 16 ms ${fmt(a.poses.get(f))}`;
      return null;
    }
  }
}

/**
 * How a program breaks the property, or null where it holds: seek back and play on against playing
 * straight through, project behind or ahead against straight play, or 16 ms frames against 32/48 ms.
 * `at` limits the check to one of `checkedAt[prop]`.
 */
export function check(prop: Property, ops: Op[], at?: number): string | null {
  let cached: ReturnType<typeof play> | undefined;
  const ref = () => {
    cached ??= play(ops, frames, kept());
    return cached;
  };
  for (const t of at === undefined ? checkedAt[prop] : [at]) {
    let failure: string | null;
    try {
      failure = checkOne(prop, ops, t, ref);
    } catch (e) {
      failure = `${prop} at ${t} threw ${(e as Error).message}`;
    }
    if (failure) return failure;
  }
  return null;
}

/**
 * Drops host calls one at a time while the program still fails at the same check, leaving a
 * program where every remaining call is needed. For a one-off: in a scratch test,
 * `console.log(shrink('seek', program(7, { anchors: true })).text)`.
 */
export function shrink(prop: Property, ops: Op[]) {
  const at = checkedAt[prop].find((t) => check(prop, ops, t) !== null);
  if (at === undefined) return { ops, failure: null, text: 'passes' };
  let kept = ops;
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < kept.length; i++) {
      const fewer = kept.filter((_, j) => j !== i);
      if (check(prop, fewer, at) !== null) {
        kept = fewer;
        changed = true;
        break;
      }
    }
  }
  const failure = check(prop, kept, at);
  const text = `${kept.map((o) => `@${o.at} ${o.desc}`).join('\n')}\n=> ${failure}`;
  return { ops: kept, failure, text };
}
