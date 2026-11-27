// Seek-replay fuzz programs: random host calls over a few hundred ms, from a seed.
import { kit, last, mul, sum, vec } from '../../src/channels.js';
import { glide, spring, tween } from '../../src/motion.js';
import { keys, patch } from '../../src/patch.js';
import { angle } from '../../src/rotation.js';
import type { Patch } from '../../src/types.js';
import { rng } from './rng.js';

export interface Pose {
  x: number;
  g: number;
  h: number;
  k: number;
  p: number[];
}
export interface Part {
  id: number;
}
export const K = () => kit<Pose>({ x: sum(), g: mul(), h: angle(), k: last(), p: vec(2, sum()) });
export const SUBJ: Part[] = [0, 1, 2, 3].map((id) => ({ id }));

export type PK =
  | 'wave'
  | 'ramp'
  | 'turn'
  | 'pick'
  | 'drift'
  | 'spring'
  | 'tween'
  | 'glide'
  | 'vspring'
  | 'sender';
const PKS: PK[] = [
  'wave',
  'ramp',
  'turn',
  'pick',
  'drift',
  'spring',
  'tween',
  'glide',
  'vspring',
  'sender',
];
const MOTION = new Set<PK>(['spring', 'tween', 'glide', 'vspring']);

export function makePatch(k: PK): Patch<Part, Pose, unknown> {
  switch (k) {
    case 'wave':
      return patch<Part, Pose>(400, (ph, s) => ({ x: Math.sin(ph * 2 * Math.PI + s.id) * 10 }), {
        writes: ['x'],
      }) as Patch<Part, Pose, unknown>;
    case 'ramp':
      return keys<Part, Pose>(300, [
        { at: 0, delta: { g: 1 } },
        { at: 1, delta: { g: 0.2 } },
      ]) as Patch<Part, Pose, unknown>;
    case 'turn':
      return keys<Part, Pose>(500, [
        { at: 0, delta: { h: 10 } },
        { at: 1, delta: { h: 280 } },
      ]) as Patch<Part, Pose, unknown>;
    case 'pick':
      return keys<Part, Pose>(240, [
        { at: 0, delta: { k: 1 } },
        { at: 0.5, delta: { k: 2 } },
        { at: 1, delta: { k: 3, p: [1, 2] } },
      ]) as Patch<Part, Pose, unknown>;
    case 'drift':
      return patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
        writes: ['x'],
        state: () => ({ x: 0 }),
        step: (s, dt) => {
          s.x += (50 - s.x) * Math.min(1, dt / 200);
        },
        pack: (s) => ({ ...s }),
        unpack: (d) => ({ ...(d as { x: number }) }),
      }) as Patch<Part, Pose, unknown>;
    case 'sender':
      return patch<Part, Pose, { n: number }>(
        200,
        (ph, s) => ({ g: 1 + 0.2 * Math.sin(ph * 6 + s.id) }),
        {
          writes: ['g'],
          state: () => ({ n: 0 }),
          step: (st, dt, s, setting) => {
            const before = Math.floor(st.n / 50);
            st.n += dt;
            if (Math.floor(st.n / 50) !== before)
              setting.send({ s: s.id, n: Math.floor(st.n / 50) });
          },
          pack: (st) => ({ ...st }),
          unpack: (d) => ({ ...(d as { n: number }) }),
        },
      ) as Patch<Part, Pose, unknown>;
    case 'spring':
      return spring<Part, Pose>('x', { from: (s) => s.id * 0.5, to: 3 }) as unknown as Patch<
        Part,
        Pose,
        unknown
      >;
    case 'tween':
      return tween<Part, Pose>('g', {
        from: (s) => 1 + s.id * 0.1,
        to: 0.3,
        ms: 200,
      }) as unknown as Patch<Part, Pose, unknown>;
    case 'glide':
      return glide<Part, Pose>('h', { from: (s) => s.id * 30, velocity: 90 }) as unknown as Patch<
        Part,
        Pose,
        unknown
      >;
    case 'vspring':
      return spring<Part, Pose, number[]>('p', {
        from: (s) => [s.id, 0],
        to: [2, 1],
      }) as unknown as Patch<Part, Pose, unknown>;
  }
}

export interface CueOp {
  k: 'cue';
  f: number;
  mix: number;
  id: number;
  patch: PK;
  loop?: boolean | number;
  fade?: { in: number; out: number };
  freeze?: 'before' | 'after' | 'both';
  weight?: number | 'around' | 'within';
  rate?: number;
  seek?: number;
  start?: number;
  stagger?: number;
  named?: boolean;
  subjects?: number[];
  role?: string;
  owner?: number;
  anchor?: {
    how: 'after' | 'with' | 'in' | 'out' | 'hit' | 'ann';
    of: number | string;
    by: number;
  };
  marks?: boolean;
  hits?: boolean;
  stepMs?: number;
}
export type Op =
  | CueOp
  | {
      k: 'owns';
      f: number;
      mix: number;
      id: number;
      rate: number;
      weight: number;
      fade?: { in: number; out: number };
      start?: number;
      owner?: number;
      span?: { duration: number; order: 'queue' | 'stagger' | 'together' };
    }
  | {
      k: 'blend';
      f: number;
      mix: number;
      id: number;
      n: number;
      loop: boolean | number;
      fade?: { in: number; out: number };
      owner?: number;
    }
  | { k: 'arc'; f: number; mix: number; id: number; hold: number | 'open'; owner?: number }
  | { k: 'call'; f: number; mix: number; cue: CueOp }
  | { k: 'announce'; f: number; mix: number; name: string; at: number }
  | { k: 'h'; f: number; tgt: number; what: string; a: number; b: number; sub: number }
  | { k: 'mute'; f: number; mix: number; over: number }
  | { k: 'drop'; f: number; mix: number; sub: number }
  | { k: 'mrate'; f: number; mix: number; v: number; over: number }
  | { k: 'tdrop'; f: number; mix: number }
  | { k: 'rebase'; f: number }
  | { k: 'jump'; f: number; by: number };

export interface Mode {
  lanes: boolean;
  transport: boolean;
  store: boolean;
  /** The transport is made with `seek: 'jump'`. */
  jump?: boolean;
}
export interface Program {
  seed: number;
  dts: number[]; // host gap before frame f (dts[0] = start time)
  ops: Op[];
  named: boolean; // staggered voices name their subjects
}

/**
 * What a program leaves out. The `no…` flags past `noCall` keep out a case with a known cause, so
 * the sweep stays green on the rest until that cause is fixed; each names what it hides.
 */
export interface GenOpts {
  transport: boolean;
  named?: boolean;
  noCall?: boolean;
  /**
   * No `around` or `within` weights: a read ahead across a tape call reads every such voice as 0,
   * and a seek back before a `drop` leaves the subject without its plot index.
   */
  noBound?: boolean;
  /** No `rebase`. */
  noRebase?: boolean;
  /**
   * No spans: a child a span's fit skipped reads back at its last frame at its cue frame, and a
   * read ahead starts a voice anchored after a fading span later than play does.
   */
  noSpan?: boolean;
  /** A subject's fade out of a voice always ramps: a read ahead at an instant one still reads it. */
  noInstantSubjectFade?: boolean;
  /** Host seeks ahead mid-run, which jump on a transport made with `seek: 'jump'`. */
  jumps?: boolean;
}
export function program(seed: number, opts: GenOpts): Program {
  const r = rng(seed);
  const F = 30 + r.i(20);
  const dts = [r.pick([0, 1000])];
  for (let f = 1; f < F; f++) dts.push(r.pick([16, 16, 16, 32, 48, 8]));
  const ops: Op[] = [];
  let id = 0;
  const mixes = opts.transport ? 2 : 1;
  const voices: { id: number; mix: number; motion: boolean; name: string }[] = [];
  const owners: { id: number; mix: number; span: boolean }[] = [];
  let anns = 0;
  const mkCue = (f: number, mx: number): CueOp => {
    const pk = r.pick(PKS);
    const c: CueOp = { k: 'cue', f, mix: mx, id: id++, patch: pk };
    if (r.p(0.4)) c.loop = r.pick([true, false, 2] as const);
    if (r.p(0.35)) c.fade = { in: r.pick([0, 50, 120]), out: r.pick([0, 60, 150]) };
    if (r.p(0.2)) c.freeze = r.pick(['before', 'after', 'both'] as const);
    const w = r.f();
    if (w < 0.15) c.weight = r.pick([0.5, 0.25, 0]);
    else if (w < 0.25) {
      const b = r.pick(['around', 'within'] as const);
      if (!opts.noBound) c.weight = b;
    }
    if (r.p(0.2)) c.rate = r.pick([0.5, 2, -1, 0]);
    if (r.p(0.15)) c.seek = r.pick([60, 130]);
    if (r.p(0.15)) c.start = r.pick([0, 48, 100, -30]);
    if (r.p(0.2)) {
      c.stagger = r.pick([30, 80]);
      c.named = opts.named ?? r.p(0.5);
    }
    if (r.p(0.15)) c.subjects = [r.i(4), r.i(4)].filter((v, i, a) => a.indexOf(v) === i);
    if (r.p(0.2)) c.role = r.pick(['r1', 'r2']);
    const myOwners = owners.filter((o) => o.mix === mx);
    if (myOwners.length && r.p(0.35)) c.owner = r.pick(myOwners).id;
    const anchorable = voices.filter((v) => opts.transport || v.mix === mx);
    if (r.p(0.3) && (anchorable.length || anns)) {
      const how = r.pick(['after', 'with', 'in', 'out', 'hit', 'ann'] as const);
      if (how === 'ann') {
        if (anns) c.anchor = { how, of: `a${r.i(anns + 1)}`, by: r.pick([0, 40, -20]) };
      } else if (anchorable.length)
        c.anchor = { how, of: r.pick(anchorable).id, by: r.pick([0, 40, -20]) };
    }
    if (r.p(0.3)) c.marks = true;
    if (r.p(0.2)) c.hits = true;
    if (r.p(0.2)) c.stepMs = r.pick([8, 12]);
    voices.push({ id: c.id, mix: mx, motion: MOTION.has(pk), name: `v${c.id}` });
    return c;
  };
  for (let f = 0; f < F; f++) {
    const n = f === 0 ? 1 + r.i(3) : r.p(0.45) ? 1 + r.i(2) : 0;
    for (let j = 0; j < n; j++) {
      const mx = r.i(mixes);
      const kind =
        f === 0 || voices.length === 0
          ? r.pick(['cue', 'cue', 'owns'] as const)
          : r.pick([
              'cue',
              'cue',
              'cue',
              'owns',
              'blend',
              'arc',
              'call',
              'announce',
              'h',
              'h',
              'h',
              'h',
              'h',
              'h',
              'mute',
              'drop',
              'drop',
              'mrate',
              'tdrop',
              'rebase',
            ] as const);
      switch (kind) {
        case 'cue':
          ops.push(mkCue(f, mx));
          break;
        case 'owns': {
          const span = r.p(0.4) && !opts.noSpan;
          const myOwners = owners.filter((o) => o.mix === mx && !o.span);
          const o: Op = {
            k: 'owns',
            f,
            mix: mx,
            id: id++,
            rate: r.pick([1, 0.5, 2]),
            weight: r.pick([1, 0.5]),
          };
          if (r.p(0.4)) o.fade = { in: 100, out: 100 };
          if (!span && r.p(0.3)) o.start = r.pick([0, 50, 120]);
          if (myOwners.length && r.p(0.3)) o.owner = r.pick(myOwners).id;
          if (span)
            o.span = {
              duration: r.pick([300, 600]),
              order: r.pick(['queue', 'stagger', 'together'] as const),
            };
          owners.push({ id: o.id, mix: mx, span });
          voices.push({ id: o.id, mix: mx, motion: false, name: `v${o.id}` });
          ops.push(o);
          break;
        }
        case 'blend': {
          const nn = 2 + r.i(2);
          const myOwners = owners.filter((o) => o.mix === mx);
          const b: Op = {
            k: 'blend',
            f,
            mix: mx,
            id,
            n: nn,
            loop: r.pick([true, false, 2] as const),
          };
          if (r.p(0.3)) b.fade = { in: 80, out: 80 };
          if (myOwners.length && r.p(0.3)) b.owner = r.pick(myOwners).id;
          for (let q = 0; q < nn; q++)
            voices.push({ id: id + q, mix: mx, motion: false, name: `v${id + q}` });
          id += nn;
          ops.push(b);
          break;
        }
        case 'arc': {
          const a: Op = { k: 'arc', f, mix: mx, id: id++, hold: r.pick([200, 'open'] as const) };
          voices.push({ id: a.id, mix: mx, motion: false, name: `v${a.id}` });
          ops.push(a);
          break;
        }
        case 'call':
          if (!opts.noCall) {
            const c = mkCue(f, mx);
            // An owned voice's start is on its owner's clock, so a driver deriving it from the host's
            // clock would cue a different voice on replay.
            if (c.owner !== undefined) delete c.start;
            ops.push({ k: 'call', f, mix: mx, cue: c });
          }
          break;
        case 'announce':
          ops.push({ k: 'announce', f, mix: mx, name: `a${anns++}`, at: r.pick([0, 30, 100]) });
          break;
        case 'h': {
          const v = r.pick(voices);
          const what = r.pick(
            v.motion
              ? (['to', 'push', 'set', 'to', 'weight', 'rate', 'seek', 'fade', 'fadeSub'] as const)
              : ([
                  'weight',
                  'rate',
                  'ramp',
                  'seek',
                  'seekKeep',
                  'fade',
                  'fadeAt',
                  'fadeSub',
                  'fadeRest',
                  'rise',
                  'release',
                ] as const),
          );
          let a = r.f();
          if (what === 'fadeSub' && opts.noInstantSubjectFade) a = Math.max(a, 0.5);
          ops.push({ k: 'h', f, tgt: v.id, what, a, b: r.f(), sub: r.i(4) });
          break;
        }
        case 'mute':
          if (r.p(0.4)) ops.push({ k: 'mute', f, mix: mx, over: r.pick([0, 100]) });
          break;
        case 'drop':
          ops.push({ k: 'drop', f, mix: mx, sub: r.i(4) });
          break;
        case 'mrate':
          ops.push({
            k: 'mrate',
            f,
            mix: mx,
            v: r.pick([0.5, 1, 2, 0, 0.25, 1]),
            over: r.pick([0, 0, 100]),
          });
          break;
        case 'tdrop':
          if (opts.transport && r.p(0.3)) ops.push({ k: 'tdrop', f, mix: 1 });
          break;
        case 'rebase':
          if (r.p(0.5) && !opts.noRebase) ops.push({ k: 'rebase', f });
          break;
      }
    }
    // Drawn only with jumps on, so every other program stays as it was.
    if (opts.jumps && f > 0 && r.p(0.12)) ops.push({ k: 'jump', f, by: r.pick([40, 250, 2000]) });
  }
  return { seed, dts, ops, named: opts.named ?? false };
}
