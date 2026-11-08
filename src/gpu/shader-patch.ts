import type { Patch, Setting } from '../types.js';
import type { Packed, Runner } from './runner.js';

/**
 * A WGSL scalar type a subject field or a patch parameter can have.
 *
 * @category gpu
 */
export type Scalar = 'f32';

/** `P`, and a `V` for each table name in `T`; the no-parameter default `P` drops out beside tables. */
type WithTables<P, T extends string, V> = [T] extends [never]
  ? P
  : (string extends keyof P ? unknown : P) & { [K in T]: V };

/**
 * What `shaderPatch` takes.
 *
 * @category gpu
 */
export interface ShaderSpec<I, O, P extends Record<string, number>, T extends string = never> {
  /**
   * WGSL statements setting fields of `out`, one per channel in `writes`, from `phase`, `pass_index`
   * (an `i32`), `subject` (the fields named in `fields`), `params` (those named in `params`), and `lag`, how many
   * ms this subject's time trails the voice's (0 where the voice does not stagger).
   */
  wgsl: string;
  /** WGSL declarations the body uses, included once however many patches share them. */
  helpers?: string;
  /** The subject's numbers the shader reads. The host hands them over in `subjects`. */
  fields?: Record<string, Scalar>;
  /** Per-voice values the shader reads, bound with `with`. */
  params?: { [K in keyof P]: Scalar };
  /**
   * Per-voice tables the shader reads, their contents bound with `with` as `width * height` numbers,
   * row-major (row `y` starts at `y * width`). WGSL reads one as `table_<name>(x, y)` and `at` as
   * `params.<name>(x, y)`; both floor their coordinates and give 0 outside `[0, width)` by
   * `[0, height)`. Only the contents are per-voice: re-giving them through `with` does not
   * recompile the kernel.
   */
  tables?: { [K in T]: { width: number; height: number } };
  /** The same math in JS, for every path that runs on the CPU. Handed the parameter and table values last. */
  at(
    phase: number,
    subject: I,
    setting: Setting<void, unknown>,
    params: WithTables<P, T, (x: number, y: number) => number>,
  ): Partial<O>;
  writes: readonly (keyof O & string)[];
}

/** What every patch `with` makes from one `shaderPatch` shares. */
export interface Shader {
  readonly wgsl: string;
  readonly helpers: string;
  readonly fields: readonly string[];
  readonly params: readonly string[];
  readonly tables: readonly { name: string; width: number; height: number }[];
  readonly writes: readonly string[];
}

/** A shader patch's GPU half: its shader, the runner the kernel runs it by, and its parameter values in `shader.params` order. */
export interface GpuDescriptor {
  readonly shader: Shader;
  readonly runner: Runner;
  readonly values: readonly number[];
  /** Each declared table's contents, in `shader.tables` order, placed after `values`. */
  readonly tables: readonly Float32Array[];
}

/**
 * A patch carrying WGSL beside its JS `at`. `with` gives a patch with those parameter values that
 * shares the same shader.
 *
 * @category gpu
 */
export interface ShaderPatch<I, O, P extends Record<string, number>, T extends string = never>
  extends Patch<I, O> {
  with(values: WithTables<P, T, ArrayLike<number>>): ShaderPatch<I, O, P, T>;
}

const descriptors = new WeakMap<object, GpuDescriptor>();

/** The patch's GPU half, or undefined for a patch `shaderPatch` did not make. */
export function gpuDescriptor(patch: object): GpuDescriptor | undefined {
  return descriptors.get(patch);
}

/** A shader patch's runner and parameter values; undefined for a patch `shaderPatch` did not make. */
export function shaderPack(patch: object): Packed | undefined {
  const d = descriptors.get(patch);
  if (d === undefined) return undefined;
  const values = new Float32Array(d.values.length + d.tables.reduce((n, t) => n + t.length, 0));
  values.set(d.values);
  let at = d.values.length;
  for (const t of d.tables) {
    values.set(t, at);
    at += t.length;
  }
  return { runner: d.runner, values };
}

let made = 0;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function check(kind: string, names: readonly string[]): void {
  for (const n of names)
    if (!IDENT.test(n) || n.startsWith('__'))
      throw new Error(`blits: ${kind} name ${JSON.stringify(n)} is not a WGSL identifier`);
}

/** The `)` closing the `(` at `open`, and the top-level argument texts between them. */
function callArgs(src: string, open: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) {
      args.push(src.slice(from, i));
      return { args, end: i + 1 };
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(from, i));
      from = i + 1;
    }
  }
  throw new Error('blits: a table call in the WGSL has no closing parenthesis');
}

/**
 * Rewrites each `table_<name>(x, y)` into a call of the shared `blits_table`, with the table's
 * place in `values` and its size written in; helpers are shared across runners, so a table
 * cannot be a function of its own.
 */
function withTables(
  wgsl: string,
  tables: readonly { name: string; width: number; height: number; at: number }[],
): string {
  if (tables.length === 0) return wgsl;
  const call = /\btable_([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let out = '';
  let last = 0;
  for (let m = call.exec(wgsl); m !== null; m = call.exec(wgsl)) {
    const t = tables.find((x) => x.name === m[1]);
    if (t === undefined) continue;
    const { args, end } = callArgs(wgsl, m.index + m[0].length - 1);
    if (args.length !== 2) throw new Error(`blits: table_${t.name} takes two arguments, x and y`);
    const [x, y] = args.map((a) => withTables(a.trim(), tables));
    out += `${wgsl.slice(last, m.index)}blits_table(base + ${t.at}u, ${t.width}u, ${t.height}u, f32(${x}), f32(${y}))`;
    last = end;
    call.lastIndex = end;
  }
  return out + wgsl.slice(last);
}

const TABLE_HELPER = `fn blits_table(at: u32, w: u32, h: u32, x: f32, y: f32) -> f32 {
  if (!(x >= 0.0 && x < f32(w) && y >= 0.0 && y < f32(h))) { return 0.0; }
  return values[at + u32(floor(y)) * w + u32(floor(x))];
}`;

/**
 * A patch written twice: as WGSL, which the `gpu` engine runs on the GPU, and as a JS `at`, which
 * every other path runs. The two must compute the same thing; in development the `gpu` engine
 * compares a sample of subjects from each and warns where they disagree. On any other engine it
 * is a plain patch.
 *
 * Both halves give every channel in `writes` a value for every subject: WGSL has no way to give
 * none, so an `at` returning `{}` for some subjects disagrees with its shader. Give the rest
 * instead: zero coverage for a color, the rule's rest for a number.
 *
 * @category gpu
 */
export function shaderPatch<
  I,
  O,
  P extends Record<string, number> = Record<string, never>,
  T extends string = never,
>(duration: number, spec: ShaderSpec<I, O, P, T>): ShaderPatch<I, O, P, T> {
  const fields = Object.keys(spec.fields ?? {});
  const params = Object.keys(spec.params ?? {});
  check('field', fields);
  check('parameter', params);
  check('channel', spec.writes);
  const declared = Object.entries<{ width: number; height: number }>(spec.tables ?? {});
  check(
    'table',
    declared.map(([n]) => n),
  );
  for (const [n] of declared)
    if (params.includes(n)) throw new Error(`blits: the name ${n} is both a parameter and a table`);
  let end = params.length;
  const placed = declared.map(([name, { width, height }]) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
      throw new Error(`blits: the table ${name} needs a whole width and height of at least 1`);
    const t = { name, width, height, at: end };
    end += width * height;
    return t;
  });
  const shader: Shader = {
    wgsl: spec.wgsl,
    helpers: spec.helpers ?? '',
    fields,
    params,
    tables: declared.map(([name, { width, height }]) => ({ name, width, height })),
    writes: spec.writes,
  };
  const runner: Runner = {
    key: `shader:${made++}`,
    helpers: placed.length === 0 ? shader.helpers : [shader.helpers, TABLE_HELPER],
    wgsl: [
      ...params.map((n, k) => `let params_${n} = values[base + ${k}u];`),
      withTables(spec.wgsl, placed),
    ].join(' '),
    writes: spec.writes,
    fields,
  };
  const make = (p: P, contents: Float32Array[]): ShaderPatch<I, O, P, T> => {
    const lookups = Object.fromEntries(
      placed.map((t, k) => [
        t.name,
        (x: number, y: number) => {
          const cx = Math.floor(x);
          const cy = Math.floor(y);
          if (!(cx >= 0 && cx < t.width && cy >= 0 && cy < t.height)) return 0;
          return contents[k]?.[cy * t.width + cx] ?? 0;
        },
      ]),
    );
    const args = { ...p, ...lookups } as WithTables<P, T, (x: number, y: number) => number>;
    const patch: ShaderPatch<I, O, P, T> = {
      form: 'fn',
      duration,
      writes: spec.writes,
      at: (phase, subject, setting) =>
        spec.at(phase, subject, setting as Setting<void, unknown>, args),
      with(given) {
        const next = given as P & Record<string, number | ArrayLike<number> | undefined>;
        for (const n of params)
          if (typeof next[n] !== 'number')
            throw new Error(`blits: with() needs a number for the parameter ${n}`);
        const bound = placed.map((t) => {
          const v = next[t.name] as ArrayLike<number> | undefined;
          if (v === undefined || v.length !== t.width * t.height)
            throw new Error(
              `blits: with() needs ${t.width} × ${t.height} numbers for the table ${t.name}`,
            );
          return Float32Array.from(v);
        });
        return make(next, bound);
      },
    };
    descriptors.set(patch, {
      shader,
      runner,
      values: params.map((n) => p[n] ?? 0),
      tables: contents,
    });
    return patch;
  };
  return make(
    {} as P,
    placed.map((t) => new Float32Array(t.width * t.height)),
  );
}
