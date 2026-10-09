import type { Handle, Kit, Mix, Patch, Signal, SpanSpec } from '@msb235/blits';
import { type Composition, type Group, isExpr, isMotion, type Voice } from './composition';
import { compileExpr, compileFit, type Faults, type Scope } from './expr';
import { fitOf } from './fit';
import { rowsOf } from './groups';
import type { Mixed } from './kit';
import { type FieldError, messageOf, type Spec, specOf } from './spec';
import type { Subject } from './stage';

/** What one mix cued: each voice's handle and patch, and each group's handle, by id. */
export interface Voices {
  handles: Map<string, Handle<Subject>>;
  patches: Map<string, Patch<Subject, Mixed, unknown>>;
  /** A span's is a `SpanHandle`. */
  groupHandles: Map<string, Handle<Subject>>;
}

export interface CueContext {
  scope: Scope;
  kit: Kit<Mixed>;
  /** The soloed voice, or null for the full mix: only the full mix reports errors and faults. */
  only: string | null;
  errors: FieldError[];
  faults: Map<string, Faults>;
}

type GroupSpec = SpanSpec<Subject>;
type Made<S> = { spec: S } | { errors: FieldError[] };

/** One group's spec, or the errors that kept it from being built. */
function groupSpecOf(g: Group, scope: Scope, faults: Faults[]): Made<GroupSpec> {
  const errors: FieldError[] = [];
  const fail = (field: string, error: string, line: number | null) =>
    errors.push({ voice: g.id, field, error, line });
  let weight: GroupSpec['weight'] = isExpr(g.weight) ? undefined : g.weight;
  if (isExpr(g.weight)) {
    const r = compileExpr<Signal<Subject>>(g.weight, scope, 0);
    if ('error' in r) fail('weight', r.error, r.line);
    else {
      faults.push(r.faults);
      weight = r.fn;
    }
  }
  const s = g.kind === 'span' ? (g.span ?? {}) : undefined;
  const made = fitOf(s?.fit, (code) => {
    const r = compileFit(code);
    if (!('error' in r)) faults.push(r.faults);
    return r;
  });
  const fit = made !== undefined && 'error' in made ? undefined : made;
  if (made !== undefined && 'error' in made) fail(`span.fit.${made.step}`, made.error, made.line);
  if (errors.length > 0) return { errors };
  const spec: GroupSpec = { start: g.start, rate: g.rate, weight, fade: g.fade, name: g.name };
  if (g.freeze) spec.freeze = g.freeze;
  if (g.anchor) {
    spec.anchor = g.anchor;
    if (g.anchor.start !== undefined || g.anchor.in !== undefined) delete spec.start;
  }
  if (s) {
    for (const k of ['duration', 'priority', 'order', 'share', 'spill'] as const)
      if (s[k] !== undefined) Object.assign(spec, { [k]: s[k] });
    if (fit) spec.fit = fit;
  }
  return { spec };
}

/** Why blits would refuse `x` as a span's child, as field errors; a span places what it holds. */
function spanRefusals(x: Voice | Group): FieldError[] {
  const out: FieldError[] = [];
  const no = (field: string, error: string) => out.push({ voice: x.id, field, error, line: null });
  if (x.anchor?.start !== undefined || x.anchor?.in !== undefined)
    no('anchor', 'a span places it, so it takes no start anchor');
  if (x.start !== 0) no('start', 'a span places it, so it takes no start');
  if ('patch' in x) {
    if (isMotion(x.patch)) no('patch', 'a span cannot fit a motion voice, which never ends');
    else if (x.loop === true) no('loop', 'a span cannot fit a voice that loops for good');
  }
  return out;
}

/** Sums every fault list `id`'s expressions keep into one. */
const faultsOf = (list: Faults[]): Faults => ({
  get count() {
    return list.reduce((n, f) => n + f.count, 0);
  },
  get first() {
    return list.find((f) => f.first)?.first ?? null;
  },
});

/**
 * Cues every group and voice of `c` on `m` in `rowsOf` order, each group before what it holds. A
 * voice or group with errors is left out, and so is everything under a group left out.
 */
export function cueAll(c: Composition, m: Mix<Subject, Mixed>, cx: CueContext): Voices {
  const voices = new Map(c.voices.map((v) => [v.id, v]));
  const groups = new Map((c.groups ?? []).map((g) => [g.id, g]));
  const out: Voices = { handles: new Map(), patches: new Map(), groupHandles: new Map() };
  const named = new Map<string, 'voice' | 'group'>();
  const report = (...e: FieldError[]) => {
    if (cx.only === null) cx.errors.push(...e);
  };

  for (const row of rowsOf(c)) {
    const x = row.kind === 'voice' ? voices.get(row.id) : groups.get(row.id);
    if (!x) continue;
    const no = (field: string, error: string) => report({ voice: x.id, field, error, line: null });
    const earlier = named.get(x.name);
    if (earlier) {
      no('name', `${earlier === 'voice' ? 'another voice' : 'a group'} is named "${x.name}"`);
      continue;
    }
    named.set(x.name, row.kind);
    const parent = x.owner === undefined ? undefined : groups.get(x.owner);
    const owner = x.owner === undefined ? undefined : out.groupHandles.get(x.owner);
    if (x.owner !== undefined && !owner) {
      no('owner', `its group "${parent?.name ?? x.owner}" has errors`);
      continue;
    }
    const under = parent?.kind === 'span';
    const refused = under ? spanRefusals(x) : [];
    const list: Faults[] = [];
    const r: Made<Spec | GroupSpec> =
      'patch' in x ? specOf(x, cx.scope, list, cx.kit) : groupSpecOf(x, cx.scope, list);
    if (refused.length > 0 || 'errors' in r) {
      report(...refused, ...('errors' in r ? r.errors : []));
      continue;
    }
    const spec = { ...r.spec, ...(owner ? { owner } : {}) };
    if (under) {
      delete spec.start;
      Object.assign(spec, x.hints);
    }
    try {
      if ('patch' in spec) {
        const solo = cx.only === null || cx.only === x.id;
        out.handles.set(x.id, m.cue(solo ? spec : { ...spec, weight: 0 }));
        out.patches.set(x.id, spec.patch);
      } else {
        const span = 'kind' in x && x.kind === 'span';
        out.groupHandles.set(x.id, span ? m.span(spec) : m.owns(spec));
      }
    } catch (err) {
      no('cue', messageOf(err));
      continue;
    }
    if (cx.only === null) cx.faults.set(x.id, faultsOf(list));
  }
  return out;
}
