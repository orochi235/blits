import {
  type VoiceSpec as BlitsVoiceSpec,
  glide,
  type Handle,
  keys,
  type Mix,
  mix,
  type Patch,
  patch,
  type Signal,
  spring,
  tween,
} from '@msb235/blits';
import { type Composition, type Expr, isExpr, type PatchSource, type Voice } from './composition';
import { compileExpr, type Faults, type Scope, scopeOf } from './expr';
import { type ChannelName, KIT, type Pose } from './kit';
import type { Subject } from './stage';

export const FRAME = 1000 / 60;

export interface FieldError {
  voice: string | null;
  field: string;
  error: string;
  line: number | null;
}

export interface Built {
  mix: Mix<Subject, Pose>;
  solos: Map<string, Mix<Subject, Pose>>;
  /** Each solo mix's own voice, so a live change reaches the solo the inspector reads too. */
  soloed: Map<string, { handle: Handle<Subject>; patch: Patch<Subject, Pose, unknown> }>;
  handles: Map<string, Handle<Subject>>;
  patches: Map<string, Patch<Subject, Pose, unknown>>;
  levels: Map<string, { set(v: number): void }>;
  faults: Map<string, Faults>;
  errors: FieldError[];
}

type Spec = BlitsVoiceSpec<Subject, Pose>;

/** One voice's spec, or the errors that kept it from being built. */
function specOf(
  v: Voice,
  scope: Scope,
  faults: Faults[],
): { spec: Spec } | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const fn = <F extends (...a: never[]) => unknown>(
    field: string,
    expr: Expr,
    fallback: ReturnType<F>,
    takes?: (out: unknown) => string | null,
  ): F | undefined => {
    const r = compileExpr<F>(expr, scope, fallback);
    if ('error' in r) {
      errors.push({ voice: v.id, field, error: r.error, line: r.line });
      return undefined;
    }
    faults.push(r.faults);
    if (!takes) return r.fn;
    const inner = r.fn as unknown as (...a: unknown[]) => unknown;
    return ((...a: unknown[]) => {
      const out = inner(...a);
      const wrong = takes(out);
      if (wrong === null) return out;
      r.faults.count++;
      r.faults.first ??= `${field} ${wrong}`;
      return fallback;
    }) as unknown as F;
  };
  const made = patchOf(v.patch, fn, (field, error) =>
    errors.push({ voice: v.id, field, error, line: null }),
  );
  const stagger = v.stagger ? fn<(s: Subject) => number>('stagger', v.stagger, 0) : undefined;
  const target = v.target ? fn<(s: Subject) => boolean>('target', v.target, false) : undefined;
  const weight = isExpr(v.weight) ? fn<Signal<Subject>>('weight', v.weight, 0) : v.weight;
  if (errors.length > 0 || made === undefined || weight === undefined) return { errors };
  const spec: Spec = {
    patch: made as Patch<Subject, Pose, unknown>,
    start: v.start,
    rate: v.rate,
    loop: v.loop,
    weight,
    fade: v.fade,
    name: v.name,
  };
  if (stagger) spec.stagger = stagger;
  if (target) spec.target = target;
  if (v.hold) spec.hold = v.hold;
  if (v.locus) spec.locus = v.locus;
  if (v.from) spec.from = v.from;
  if (v.anchor) {
    spec.anchor = v.anchor;
    if (v.anchor.start !== undefined || v.anchor.in !== undefined) delete spec.start;
  }
  return { spec };
}

type Fn = <F extends (...a: never[]) => unknown>(
  field: string,
  expr: Expr,
  fallback: ReturnType<F>,
  takes?: (out: unknown) => string | null,
) => F | undefined;
type Fail = (field: string, error: string) => void;

const PER_SUBJECT = new Set(['to', 'from', 'velocity']);
const REQUIRED = { spring: ['to'], glide: ['from'], tween: ['from', 'to', 'ms'] } as const;

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Why blits would refuse `out` for this motion option, or null when it takes it. */
export function refusalOf(channel: ChannelName, key: string): (out: unknown) => string | null {
  if (key === 'ms') return (out) => (finite(out) && out > 0 ? null : 'takes a positive number');
  const rest = KIT[channel].rest;
  if (!Array.isArray(rest)) return (out) => (finite(out) ? null : 'takes a number');
  const n = rest.length;
  return (out) =>
    Array.isArray(out) && out.length === n && out.every(finite) ? null : `takes ${n} numbers`;
}

/** What a motion option gives a subject its expression throws on: a value the channel can take. */
function fallbackOf(channel: ChannelName, key: string): number | number[] {
  const rest = KIT[channel].rest as number | number[] | undefined;
  const zero = Array.isArray(rest) ? rest.map(() => 0) : 0;
  if (key === 'to' || key === 'from') return rest ?? zero;
  if (key === 'ms') return FRAME;
  return key === 'velocity' ? zero : 0;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function patchOf(p: PatchSource, fn: Fn, fail: Fail): Patch<Subject, Pose, unknown> | undefined {
  if (p.kind === 'keys') {
    try {
      return keys<Subject, Pose>(p.period, p.stops, p.ease ? { ease: p.ease } : {});
    } catch (err) {
      fail('stops', messageOf(err));
      return undefined;
    }
  }
  if (p.kind === 'fn') {
    const at = fn<(phase: number, s: Subject, set: never) => Partial<Pose>>(
      'at',
      { code: p.at },
      {},
    );
    const state = p.state
      ? fn<(s: Subject) => unknown>('state', { code: p.state }, undefined)
      : undefined;
    const step = p.step
      ? fn<(st: unknown, dt: number) => void>('step', { code: p.step }, undefined)
      : undefined;
    if (!at || (p.state && !state) || (p.step && !step)) return undefined;
    try {
      return patch<Subject, Pose, unknown>(p.period, at as never, {
        writes: p.writes,
        ...(state ? { state } : {}),
        ...(step ? { step: step as never } : {}),
      }) as Patch<Subject, Pose, unknown>;
    } catch (err) {
      fail('writes', messageOf(err));
      return undefined;
    }
  }
  let ok = true;
  const bad = (field: string, error: string) => {
    fail(field, error);
    ok = false;
  };
  for (const k of REQUIRED[p.kind]) if (p.opts[k] === undefined) bad(`opts.${k}`, 'is required');
  const opts: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.opts)) {
    if (!isExpr(v)) {
      const wrong =
        PER_SUBJECT.has(k) || (p.kind === 'tween' && k === 'ms')
          ? refusalOf(p.channel, k)(v)
          : finite(v)
            ? null
            : 'takes a number';
      if (wrong !== null) bad(`opts.${k}`, wrong);
      opts[k] = v;
    } else if (!PER_SUBJECT.has(k) && !(p.kind === 'tween' && k === 'ms')) {
      bad(`opts.${k}`, 'takes a number');
    } else {
      const f = fn<(s: Subject) => unknown>(
        `opts.${k}`,
        v,
        fallbackOf(p.channel, k),
        refusalOf(p.channel, k),
      );
      if (f) opts[k] = f;
      else ok = false;
    }
  }
  if (!ok) return undefined;
  if (p.kind === 'tween' && p.ease) opts.ease = p.ease;
  const maker = p.kind === 'spring' ? spring : p.kind === 'glide' ? glide : tween;
  try {
    return maker<Subject, Pose, number | number[]>(p.channel, opts as never) as unknown as Patch<
      Subject,
      Pose,
      unknown
    >;
  } catch (err) {
    fail('opts', messageOf(err));
    return undefined;
  }
}

export function compile(
  c: Composition,
  subjects: readonly Subject[],
  opts: { solos?: boolean } = {},
): Built {
  const scope = scopeOf(c.levels);
  const { levels } = scope;
  const errors: FieldError[] = [];
  const faults = new Map<string, Faults>();
  const patches = new Map<string, Patch<Subject, Pose, unknown>>();

  // Specs are built afresh per mix: a motion patch keeps its state on itself and plays on one voice.
  const make = (only: string | null) => {
    const m = mix<Subject, Pose>(KIT, { stepMs: FRAME });
    const handles = new Map<string, Handle<Subject>>();
    let own: { handle: Handle<Subject>; patch: Patch<Subject, Pose, unknown> } | null = null;
    const named = new Set<string>();
    for (const v of c.voices) {
      if (named.has(v.name)) {
        if (only === null)
          errors.push({
            voice: v.id,
            field: 'name',
            error: `another voice is named "${v.name}"`,
            line: null,
          });
        continue;
      }
      named.add(v.name);
      const list: Faults[] = [];
      const r = specOf(v, scope, list);
      if ('errors' in r) {
        if (only === null) errors.push(...r.errors);
        continue;
      }
      const spec = only === null || only === v.id ? r.spec : { ...r.spec, weight: 0 };
      try {
        const handle = m.cue(spec);
        handles.set(v.id, handle);
        if (only === v.id) own = { handle, patch: spec.patch };
      } catch (err) {
        if (only === null)
          errors.push({
            voice: v.id,
            field: 'cue',
            error: messageOf(err),
            line: null,
          });
        continue;
      }
      if (only === null) {
        patches.set(v.id, r.spec.patch);
        faults.set(v.id, {
          get count() {
            return list.reduce((n, f) => n + f.count, 0);
          },
          get first() {
            return list.find((f) => f.first)?.first ?? null;
          },
        });
      }
    }
    return { m, handles, own };
  };
  const full = make(null);
  const solos = new Map<string, Mix<Subject, Pose>>();
  const soloed: Built['soloed'] = new Map();
  if (opts.solos)
    for (const id of full.handles.keys()) {
      const made = make(id);
      solos.set(id, made.m);
      if (made.own) soloed.set(id, made.own);
    }
  void subjects;
  return { mix: full.m, solos, soloed, handles: full.handles, patches, levels, faults, errors };
}
