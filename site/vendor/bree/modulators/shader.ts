import { type WaveShape, waveAt } from '@msb235/blits';
import { gpuOf, type ShaderPatch, type ShaderSpec, shaderPatch } from '@msb235/blits/gpu';
import type { Board, Pose, Subject } from '../board.js';
import { CLOSED, closedRank, type Order } from '../orders.js';
import type { Channel } from '../planes.js';
import { HASH_WGSL } from '../render/wgsl-hash.js';

/** The numbers a modulator's shader reads, by name; every one has a `cycles`. */
export type Bound = Record<string, number>;

/** A modulator's cycle as a shader patch: `with` rebinds its numbers, `cycles` among them. */
export type ModShader = ShaderPatch<Subject, Pose, Bound>;

/** The numbers each shader reads from a subject: a cell has `cell` 1 and its `i`, a dot its place. */
export const fieldsOf = (s: Subject): Record<string, number> =>
  s.kind === 'cell' ? { x: 0, y: 0, cell: 1, i: s.i } : { x: s.x, y: s.y, cell: 0, i: 0 };

export const FIELDS = { x: 'f32', y: 'f32', cell: 'f32', i: 'f32' } as const;

/** Wave shapes by the code a shader reads. */
export const SHAPES: readonly WaveShape[] = ['sine', 'triangle', 'saw', 'square'];

/** `unitAt` for the shape whose code in `SHAPES` is `shape`. */
export const unitOf = (shape: number, x: number) => (waveAt(SHAPES[shape] ?? 'sine', x) + 1) / 2;

/**
 * What every modulator's shader may call, one string so the kernel includes it once: `hash`,
 * `closedRank`, `unitOf`, `bump` and fire's `noise`.
 */
export const HELPERS = `${HASH_WGSL}
fn bree_rank(by: f32, cols: f32, x: f32, y: f32, cell: f32, i: f32) -> f32 {
  if (by < 0.5) { return 0.0; }
  if (cell > 0.5) { return i; }
  let col = clamp(floor(x + 0.5), 0.0, cols - 1.0);
  if (by < 1.5) { return col; }
  if (by < 2.5) { return cols - 1.0 - col; }
  if (by < 3.5) { return floor(abs(col - (cols - 1.0) * 0.5)); }
  return y;
}
fn bree_unit(shape: f32, x: f32) -> f32 {
  let u = x - floor(x);
  var w: f32;
  if (shape < 0.5) { w = sin(6.283185307179586 * u); }
  else if (shape < 1.5) { w = select(select(4.0 * u - 4.0, 2.0 - 4.0 * u, u < 0.75), 4.0 * u, u < 0.25); }
  else if (shape < 2.5) { w = select(2.0 * u - 2.0, 2.0 * u, u < 0.5); }
  else { w = select(-1.0, 1.0, u < 0.5); }
  return (w + 1.0) * 0.5;
}
fn bree_smooth(t: f32) -> f32 { return t * t * (3.0 - 2.0 * t); }
fn bree_noise_at(i: i32, j: i32, period: i32) -> f32 {
  return bree_hash(i, ((j % period) + period) % period, period);
}
fn bree_noise(x: f32, y: f32, period: i32) -> f32 {
  let ix = i32(floor(x));
  let iy = i32(floor(y));
  let fx = bree_smooth(x - floor(x));
  let fy = bree_smooth(y - floor(y));
  let top = bree_noise_at(ix, iy, period) + (bree_noise_at(ix + 1, iy, period) - bree_noise_at(ix, iy, period)) * fx;
  let low = bree_noise_at(ix, iy + 1, period) + (bree_noise_at(ix + 1, iy + 1, period) - bree_noise_at(ix, iy + 1, period)) * fx;
  return top + (low - top) * fy;
}
fn bree_bump(d: f32) -> f32 {
  return select(0.5 + 0.5 * cos(3.141592653589793 * d), 0.0, abs(d) >= 1.0);
}`;

/** The rank a shader reads for subject `s`: `bree_rank` over `params.by` and `params.cols`. */
export const RANK =
  'bree_rank(params.by, params.cols, subject.x, subject.y, subject.cell, subject.i)';

/** `closedRank` reading the order and width a ranked shader is bound with. */
export const rankAt = (p: Bound, s: Subject) => closedRank(p.by ?? 0, p.cols ?? 1, s);

/** The order and board width a ranked shader reads. */
export type Ranked = { readonly by: number; readonly cols: number };

/** The numbers a ranked shader reads for `order` on `b`, or null where its rank has no closed form. */
export function ranked(order: Order, b: Board): Ranked | null {
  const by = CLOSED[order.by];
  return by === undefined ? null : { by, cols: b.cols };
}

/** A number as a WGSL f32 literal. */
export const f32 = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/** A shader's tables in JS, by name: `(x, y)` floored, 0 outside. */
export type Tables = Readonly<Record<string, (x: number, y: number) => number>>;

/** What a shader is bound with: its numbers, and each table's contents row by row. */
export type Given = Record<string, number | ArrayLike<number>>;

/** What `shader` takes: a modulator's cycle written twice, reading its phase in the cycle as `ph`. */
export interface Spec {
  /** WGSL statements setting `out.<channel>` for every channel in `writes`, every subject. */
  readonly wgsl: string;
  /** The names of the numbers it reads besides `cycles`, as `params.<name>` in WGSL. */
  readonly params: readonly string[];
  /** Tables it reads as `table_<name>(x, y)` in WGSL, by name. */
  readonly tables?: Sizes;
  /** The same in JS, giving every channel in `writes` for every subject: a rest where it does nothing. */
  at(ph: number, s: Subject, p: Bound, t: Tables): Partial<Pose>;
  readonly writes: readonly Channel[];
}

/**
 * A cache of the `limit` values last asked for, as a function: `(key, make)` gives the one held for `key`, or
 * makes it, dropping the one asked for longest ago.
 */
export function recent<K, V>(limit: number): (key: K, make: () => V) => V {
  const held = new Map<K, V>();
  return (key, make) => {
    const had = held.get(key);
    held.delete(key);
    const v = had ?? make();
    if (held.size >= limit) held.delete(held.keys().next().value as K);
    held.set(key, v);
    return v;
  };
}

/** Whether `m` is a mix the gpu engine made, which folds shader patches on the GPU. */
export function onGpu(m: object): boolean {
  try {
    gpuOf(m as never);
    return true;
  } catch {
    return false;
  }
}

interface Made {
  readonly make: (duration: number, values: Given) => ModShader;
  readonly values: Given;
}
const made = new WeakMap<object, Made>();

/** Kernels a shader keeps, one per duration and set of table sizes it is cued at. */
const KEEP = 16;

/** Each table's size, by name. */
export type Sizes = Readonly<Record<string, { width: number; height: number }>>;

/** What `kernels` takes: one shader's WGSL body and its JS twin, over named numbers. */
export interface Kernel {
  readonly params: readonly string[];
  readonly wgsl: string;
  at(phase: number, s: Subject, v: Bound): Partial<Pose>;
  readonly writes: readonly Channel[];
}

/**
 * A shader's patches: cues of one duration and table sizes share a kernel, the newest `KEEP` kept,
 * and each is bound with its numbers and its tables' contents, row by row.
 */
export function kernels(k: Kernel): (duration: number, sizes: Sizes, given: Given) => ModShader {
  const held = recent<string, ModShader>(KEEP);
  const params = Object.fromEntries(k.params.map((n) => [n, 'f32' as const]));
  return (duration, sizes, given) => {
    const named = Object.entries(sizes).map(([n, t]) => `${n} ${t.width}x${t.height}`);
    const base = held([duration, ...named].join(' '), () =>
      shaderPatch<Subject, Pose, Bound>(duration, {
        helpers: HELPERS,
        fields: FIELDS,
        params,
        ...(named.length > 0 && { tables: sizes }),
        wgsl: k.wgsl,
        at: (phase, s, _setting, v) => k.at(phase, s, v),
        writes: k.writes,
      } as ShaderSpec<Subject, Pose, Bound>),
    );
    return base.with(given as Bound);
  };
}

/**
 * A modulator's shader: cues of one duration share a kernel, and `with` gives each its numbers.
 * Bound with `cycles` (default 1), its phase runs that many times round the cycle per pass.
 */
export function shader(spec: Spec): (duration: number, values: Given) => ModShader {
  const bind = kernels({
    params: ['cycles', ...spec.params],
    wgsl: `let ph = fract(phase * params.cycles); ${spec.wgsl}`,
    at: (phase, s, v) => spec.at((phase * (v.cycles ?? 1)) % 1, s, v, v as unknown as Tables),
    writes: spec.writes,
  });
  const make = (duration: number, given: Given): ModShader => {
    const values = { cycles: 1, ...given };
    const p = bind(duration, spec.tables ?? {}, values);
    made.set(p, { make, values });
    return p;
  };
  return make;
}

/**
 * A modulator's shader patch played `ms` long, its cycles laid end to end through it as a plain
 * patch's would be; undefined for a patch `shader` did not make.
 */
export function stretch(cycle: object & { duration: number }, ms: number): ModShader | undefined {
  const m = made.get(cycle);
  if (!m) return undefined;
  const cycles = ((m.values.cycles as number) ?? 1) * (ms / Math.max(1, cycle.duration));
  return m.make(ms, { ...m.values, cycles });
}
