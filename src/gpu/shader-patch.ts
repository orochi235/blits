import type { Patch, Setting } from '../types.js';
import type { Packed, Runner } from './runner.js';

/**
 * A WGSL scalar type a subject field or a patch parameter can have.
 *
 * @category gpu
 */
export type Scalar = 'f32';

/**
 * What `shaderPatch` takes.
 *
 * @category gpu
 */
export interface ShaderSpec<I, O, P extends Record<string, number>> {
  /**
   * WGSL statements setting fields of `out`, one per channel in `writes`, from `phase`, `pass_index`,
   * `subject` (the fields named in `fields`), and `params` (those named in `params`).
   */
  wgsl: string;
  /** WGSL declarations the body uses, included once however many patches share them. */
  helpers?: string;
  /** The subject's numbers the shader reads. The host hands them over in `subjects`. */
  fields?: Record<string, Scalar>;
  /** Per-voice values the shader reads, bound with `with`. */
  params?: { [K in keyof P]: Scalar };
  /** The same math in JS, for every path that runs on the CPU. Handed the parameter values last. */
  at(phase: number, subject: I, setting: Setting<void, unknown>, params: P): Partial<O>;
  writes: readonly (keyof O & string)[];
}

/** What every patch `with` makes from one `shaderPatch` shares. */
export interface Shader {
  readonly wgsl: string;
  readonly helpers: string;
  readonly fields: readonly string[];
  readonly params: readonly string[];
  readonly writes: readonly string[];
}

/** A shader patch's GPU half: its shader, the runner the kernel runs it by, and its parameter values in `shader.params` order. */
export interface GpuDescriptor {
  readonly shader: Shader;
  readonly runner: Runner;
  readonly values: readonly number[];
}

/**
 * A patch carrying WGSL beside its JS `at`. `with` gives a patch with those parameter values that
 * shares the same shader.
 *
 * @category gpu
 */
export interface ShaderPatch<I, O, P extends Record<string, number>> extends Patch<I, O> {
  with(values: P): ShaderPatch<I, O, P>;
}

const descriptors = new WeakMap<object, GpuDescriptor>();

/** The patch's GPU half, or undefined for a patch `shaderPatch` did not make. */
export function gpuDescriptor(patch: object): GpuDescriptor | undefined {
  return descriptors.get(patch);
}

/** A shader patch's runner and parameter values; undefined for a patch `shaderPatch` did not make. */
export function shaderPack(patch: object): Packed | undefined {
  const d = descriptors.get(patch);
  return d === undefined ? undefined : { runner: d.runner, values: Float32Array.from(d.values) };
}

let made = 0;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function check(kind: string, names: readonly string[]): void {
  for (const n of names)
    if (!IDENT.test(n) || n.startsWith('__'))
      throw new Error(`blits: ${kind} name ${JSON.stringify(n)} is not a WGSL identifier`);
}

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
export function shaderPatch<I, O, P extends Record<string, number> = Record<string, never>>(
  duration: number,
  spec: ShaderSpec<I, O, P>,
): ShaderPatch<I, O, P> {
  const fields = Object.keys(spec.fields ?? {});
  const params = Object.keys(spec.params ?? {});
  check('field', fields);
  check('parameter', params);
  check('channel', spec.writes);
  const shader: Shader = {
    wgsl: spec.wgsl,
    helpers: spec.helpers ?? '',
    fields,
    params,
    writes: spec.writes,
  };
  const runner: Runner = {
    key: `shader:${made++}`,
    helpers: shader.helpers,
    wgsl: [...params.map((n, k) => `let params_${n} = values[base + ${k}u];`), spec.wgsl].join(' '),
    writes: spec.writes,
    fields,
  };
  const make = (p: P): ShaderPatch<I, O, P> => {
    const patch: ShaderPatch<I, O, P> = {
      form: 'fn',
      duration,
      writes: spec.writes,
      at: (phase, subject, setting) =>
        spec.at(phase, subject, setting as Setting<void, unknown>, p),
      with(next: P) {
        for (const n of params)
          if (typeof next[n] !== 'number')
            throw new Error(`blits: with() needs a number for the parameter ${n}`);
        return make(next);
      },
    };
    descriptors.set(patch, { shader, runner, values: params.map((n) => p[n] ?? 0) });
    return patch;
  };
  return make({} as P);
}
