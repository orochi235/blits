import { Store } from './store.js';
import type { Patch, Setting } from './types.js';

/** A number, or one number per axis. */
export type Value = number | readonly number[];
/** One value for every subject, or one per subject. */
export type PerSubject<I, V> = V | ((subject: I) => V);

/**
 * Where a subject is and how fast it is moving, at one moment of voice time.
 *
 * @category patch
 */
export interface Motion<V extends Value = number> {
  value: V;
  /** Units per second. */
  velocity: V;
}

/** One closed-form stretch: released at `at` (voice ms) from `x0` moving at `v0`, toward `to`. */
interface Segment {
  at: number;
  x0: number[];
  v0: number[];
  to: number[];
}

interface Change {
  /** Voice ms it takes effect at; absent, at the subject's next read. */
  at?: number;
  to?: number[];
  v?: number[];
}

interface Held {
  segment: Segment | null;
  /** Changes not yet applied, in the order they were asked for. */
  pending: Change[];
  /** The voice time of the last read, for `read` with no time given. */
  last: number;
}

/** One axis, `t` seconds after release, `y0` from where it heads and moving at `v0`: [y, dy/dt]. */
type Solve = (y0: number, v0: number, t: number) => [number, number];

const axes = (v: Value): number[] => (typeof v === 'number' ? [v] : [...v]);
const per = <I, V>(p: PerSubject<I, V>, subject: I): V =>
  typeof p === 'function' ? (p as (s: I) => V)(subject) : p;

/**
 * A patch whose motion is a closed form per subject, so it lands in the same place at any frame
 * rate, and whose changes mid-flight start from where the subject is and how fast it moves.
 *
 * @category patch
 */
export type Moving<I, O, V extends Value> = Patch<I, O, void> & {
  /** Where `subject` is and how fast it moves at voice time `at`, default its last read. */
  read(subject: I, at?: number): Motion<V> | undefined;
  /** Sets `subject` moving at `velocity`, units per second, from voice time `at`, default its next read. */
  push(subject: I, velocity: V, at?: number): void;
};

interface Shape<I, V extends Value> {
  /** Where a subject starts. */
  from: (subject: I) => number[];
  /** How fast it starts. */
  velocity: (subject: I) => number[];
  /** Where it heads when released from `x` at `v`, given where it was heading. */
  aim: (x: number[], v: number[], was: number[] | null, subject: I) => number[];
  solve: Solve;
  settle: number;
  template: (subject: I) => V;
}

function moving<I, O, V extends Value>(writes: keyof O, shape: Shape<I, V>) {
  const held = new Store<I, Held>();

  const entry = (subject: I): Held => {
    let h = held.get(subject);
    if (h === undefined) {
      h = { segment: null, pending: [], last: Number.NaN };
      held.set(subject, h);
    }
    return h;
  };

  const evaluate = (seg: Segment, at: number): { x: number[]; v: number[] } => {
    const t = Math.max(0, at - seg.at) / 1000;
    const x = new Array<number>(seg.to.length);
    const v = new Array<number>(seg.to.length);
    let still = shape.settle > 0;
    for (let i = 0; i < seg.to.length; i++) {
      const to = seg.to[i] as number;
      const [y, dy] = shape.solve((seg.x0[i] as number) - to, seg.v0[i] as number, t);
      x[i] = to + y;
      v[i] = dy;
      if (Math.abs(y) > shape.settle || Math.abs(dy) > shape.settle) still = false;
    }
    if (still) return { x: [...seg.to], v: seg.to.map(() => 0) };
    return { x, v };
  };

  const release = (at: number, x: number[], v: number[], was: number[] | null, subject: I) => ({
    at,
    x0: x,
    v0: v,
    to: shape.aim(x, v, was, subject),
  });

  /** Brings a subject's motion up to `now`, applying every change due by then, in order. */
  const advance = (subject: I, h: Held, now: number): Segment => {
    h.segment ??= release(0, shape.from(subject), shape.velocity(subject), null, subject);
    while (h.pending.length > 0) {
      const change = h.pending[0] as Change;
      const at = change.at ?? now;
      if (at > now) break;
      h.pending.shift();
      const seg = h.segment;
      const { x, v } = evaluate(seg, at);
      const vel = change.v ?? v;
      h.segment = release(at, x, vel, change.to ?? seg.to, subject);
    }
    return h.segment;
  };

  const out = (subject: I, xs: number[]): V => {
    const t = shape.template(subject);
    return (typeof t === 'number' ? xs[0] : xs) as V;
  };

  const patch = {
    form: 'fn' as const,
    period: 0,
    writes: [writes] as (keyof O)[],
    at(_phase: number, subject: I, setting: Setting<void>): Partial<O> {
      const h = entry(subject);
      const seg = advance(subject, h, setting.elapsed);
      h.last = setting.elapsed;
      return { [writes]: out(subject, evaluate(seg, setting.elapsed).x) } as Partial<O>;
    },
    read(subject: I, at?: number): Motion<V> | undefined {
      const h = held.get(subject);
      if (h === undefined || h.segment === null) return undefined;
      const { x, v } = evaluate(h.segment, at ?? h.last);
      return { value: out(subject, x), velocity: out(subject, v) };
    },
    push(subject: I, velocity: V, at?: number): void {
      entry(subject).pending.push({ at, v: axes(velocity) });
    },
  };
  const change = (subject: I, c: Change) => entry(subject).pending.push(c);
  return { patch, change };
}

interface Common<I, V extends Value> {
  /** Units per second each subject starts moving at. Default 0. */
  velocity?: PerSubject<I, V>;
  /**
   * Within this distance of where it heads, and this slow, a subject lands there exactly, so a mix
   * can see it at rest. Default 1e-4; 0 keeps the curve exact.
   */
  settle?: number;
}

/**
 * A damped spring toward a target, solved in closed form. `to(subject, target)` retargets one
 * subject mid-flight, and the new stretch starts from where it is and how fast it moves, so there is
 * no kink. Time is the voice's, so `rate` and `seek` apply; a read earlier than the latest change
 * evaluates the latest stretch, not history. Its state is its own, kept per subject: cue each spring
 * on one voice.
 *
 * @category patch
 */
export function spring<I, O, V extends Value = number>(
  writes: keyof O,
  opts: Common<I, V> & {
    to: PerSubject<I, V>;
    /** Where each subject starts. Default: `to`, at rest. */
    from?: PerSubject<I, V>;
    /** Per second squared. Default 170. */
    stiffness?: number;
    /** Per second. Default 26, just short of critical at the default stiffness. */
    damping?: number;
    mass?: number;
  },
): Moving<I, O, V> & {
  /** Heads `subject` for `target` from voice time `at`, default its next read, keeping its velocity. */
  to(subject: I, target: V, at?: number): void;
} {
  const k = opts.stiffness ?? 170;
  const c = opts.damping ?? 26;
  const m = opts.mass ?? 1;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  let solve: Solve;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    solve = (y0, v0, t) => {
      const e = Math.exp(-zeta * w0 * t);
      const b = (v0 + zeta * w0 * y0) / wd;
      const cos = Math.cos(wd * t);
      const sin = Math.sin(wd * t);
      const y = e * (y0 * cos + b * sin);
      return [y, -zeta * w0 * y + e * wd * (b * cos - y0 * sin)];
    };
  } else if (zeta === 1) {
    solve = (y0, v0, t) => {
      const e = Math.exp(-w0 * t);
      const b = v0 + w0 * y0;
      const y = e * (y0 + b * t);
      return [y, e * b - w0 * y];
    };
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s);
    const r2 = -w0 * (zeta + s);
    solve = (y0, v0, t) => {
      const a = (v0 - r2 * y0) / (r1 - r2);
      const b = y0 - a;
      const e1 = Math.exp(r1 * t);
      const e2 = Math.exp(r2 * t);
      return [a * e1 + b * e2, a * r1 * e1 + b * r2 * e2];
    };
  }
  const target = (subject: I) => axes(per(opts.to, subject));
  const { patch, change } = moving<I, O, V>(writes, {
    from: (s) => axes(per(opts.from ?? opts.to, s)),
    velocity: (s) =>
      opts.velocity === undefined ? target(s).map(() => 0) : axes(per(opts.velocity, s)),
    aim: (_x, _v, was, s) => was ?? target(s),
    solve,
    settle: opts.settle ?? 1e-4,
    template: (s) => per(opts.to, s),
  });
  return Object.assign(patch, {
    to: (subject: I, goal: V, at?: number) => change(subject, { at, to: axes(goal) }),
  }) as unknown as ReturnType<typeof spring<I, O, V>>;
}

/**
 * Coasting under friction, a fling: a subject keeps its velocity, which falls by a factor of e every
 * `ms`, and comes to rest `velocity · ms / 1000` past where it was released. `push` sets it moving
 * again from wherever it is. Closed form, so frame rate does not change where it stops.
 *
 * @category patch
 */
export function glide<I, O, V extends Value = number>(
  writes: keyof O,
  opts: Common<I, V> & {
    /** Where each subject starts. */
    from: PerSubject<I, V>;
    /** The friction's time constant, ms. Default 325, a touch scroll's. */
    ms?: number;
  },
): Moving<I, O, V> {
  const tau = (opts.ms ?? 325) / 1000;
  // Released at x moving at v, a glide comes to rest at x + v·τ; y is the distance still to go,
  // which friction closes as e^(−t/τ), and its derivative at release is v again.
  const solve: Solve = (y0, _v0, t) => {
    const e = Math.exp(-t / tau);
    return [y0 * e, (-y0 / tau) * e];
  };
  const { patch } = moving<I, O, V>(writes, {
    from: (s) => axes(per(opts.from, s)),
    velocity: (s) =>
      opts.velocity === undefined
        ? axes(per(opts.from, s)).map(() => 0)
        : axes(per(opts.velocity, s)),
    aim: (x, v) => x.map((xi, i) => xi + (v[i] as number) * tau),
    solve,
    settle: opts.settle ?? 1e-4,
    template: (s) => per(opts.from, s),
  });
  return patch as unknown as Moving<I, O, V>;
}
