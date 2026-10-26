import type { Handle, Kit, Mix, Patch, Signal, SpanSpec } from '@msb235/blits';
import { type Blend, blendOf, strayOf } from './blend';
import { type Composition, type Group, isExpr, isMotion, type Voice } from './composition';
import { cueBlend } from './cueBlend';
import { compileExpr, compileFit, type Faults, type Scope } from './expr';
import { fitOf } from './fit';
import { rowsOf } from './groups';
import type { Mixed } from './kit';
import { type FieldError, markInto, messageOf, type Spec, specOf } from './spec';
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

/** Where `faults` keeps code fit step `step` of group `id`'s own count, beside the group's total. */
export const fitFaultKey = (id: string, step: number) => `${id} span.fit.${step}`;

/** One group's spec, or the errors that kept it from being built; each code fit step's faults by step. */
function groupSpecOf(
  g: Group,
  scope: Scope,
  faults: Faults[],
  steps: Map<number, Faults>,
): Made<GroupSpec> {
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
  const made = fitOf(s?.fit, (code, step) => {
    const r = compileFit(code);
    if (!('error' in r)) {
      faults.push(r.faults);
      steps.set(step, r.faults);
    }
    return r;
  });
  const fit = made !== undefined && 'error' in made ? undefined : made;
  if (made !== undefined && 'error' in made) fail(`span.fit.${made.step}`, made.error, made.line);
  if (s && g.rate < 0)
    fail('rate', 'a span lays out its members forward, so it takes none below 0', null);
  if (errors.length > 0) return { errors };
  const spec: GroupSpec = { start: g.start, rate: g.rate, weight, fade: g.fade, name: g.name };
  if (g.seek !== undefined) spec.seek = g.seek;
  if (g.freeze) spec.freeze = g.freeze;
  markInto(spec, g);
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

/** A voice or group ready to cue: its spec, and the faults its expressions keep. */
interface Ready<S = Spec | GroupSpec> {
  x: Voice | Group;
  spec: S;
  list: Faults[];
  steps: Map<number, Faults>;
}

/**
 * Cues every group and voice of `c` on `m` in `rowsOf` order, each group before what it holds, and
 * a blend's voices together where its first one sits. A voice or group with errors is left out,
 * and so is everything under a group left out.
 */
export function cueAll(c: Composition, m: Mix<Subject, Mixed>, cx: CueContext): Voices {
  const voices = new Map(c.voices.map((v) => [v.id, v]));
  const groups = new Map((c.groups ?? []).map((g) => [g.id, g]));
  const out: Voices = { handles: new Map(), patches: new Map(), groupHandles: new Map() };
  const named = new Map<string, 'voice' | 'group'>();
  const blended = new Set<string>();
  const report = (...e: FieldError[]) => {
    if (cx.only === null) cx.errors.push(...e);
  };
  const fail = (x: Voice | Group, field: string, error: string) =>
    report({ voice: x.id, field, error, line: null });

  const ready = (x: Voice | Group): Ready | undefined => {
    const earlier = named.get(x.name);
    if (earlier) {
      const what = earlier === 'voice' ? 'another voice' : 'a group';
      fail(x, 'name', `${what} is named "${x.name}"`);
      return undefined;
    }
    named.set(x.name, 'patch' in x ? 'voice' : 'group');
    const parent = x.owner === undefined ? undefined : groups.get(x.owner);
    const owner = x.owner === undefined ? undefined : out.groupHandles.get(x.owner);
    if (x.owner !== undefined && !owner) {
      fail(x, 'owner', `its group "${parent?.name ?? x.owner}" has errors`);
      return undefined;
    }
    const under = parent?.kind === 'span';
    const refused = under ? spanRefusals(x) : [];
    const list: Faults[] = [];
    const steps = new Map<number, Faults>();
    const r: Made<Spec | GroupSpec> =
      'patch' in x ? specOf(x, cx.scope, list, cx.kit) : groupSpecOf(x, cx.scope, list, steps);
    if (refused.length > 0 || 'errors' in r) {
      report(...refused, ...('errors' in r ? r.errors : []));
      return undefined;
    }
    const spec = { ...r.spec, ...(owner ? { owner } : {}) };
    if (under) {
      delete spec.start;
      Object.assign(spec, x.hints);
    }
    return { x, spec, list, steps };
  };

  const keep = ({ x, list, steps }: Ready) => {
    if (cx.only !== null) return;
    cx.faults.set(x.id, faultsOf(list));
    for (const [i, f] of steps) cx.faults.set(fitFaultKey(x.id, i), f);
  };

  const cueMembers = (blend: Blend) => {
    const lead = blend.members[0] as Voice;
    const members = blend.members.flatMap((v) => {
      const stray = strayOf(lead, v);
      if (stray !== null)
        fail(v, 'role', `a blend plays its voices by one spec: its ${stray} is not ${lead.name}'s`);
      const r = stray === null ? ready(v) : undefined;
      return r && 'patch' in r.spec ? [{ ...r, id: v.id, spec: r.spec }] : [];
    });
    const first = members[0];
    if (!first) return;
    const by = compileExpr<Signal<Subject>>(blend.by, cx.scope, 0);
    if ('error' in by)
      return report({ voice: first.id, field: 'blend', error: by.error, line: by.line });
    first.list.push(by.faults);
    try {
      const handles = cueBlend(m, members, by.fn, blend.role, cx.only);
      members.forEach((r, i) => {
        out.handles.set(r.id, handles[i] as Handle<Subject>);
        out.patches.set(r.id, r.spec.patch);
        keep(r);
      });
    } catch (err) {
      fail(first.x, 'cue', messageOf(err));
    }
  };

  for (const row of rowsOf(c)) {
    const x = row.kind === 'voice' ? voices.get(row.id) : groups.get(row.id);
    if (!x) continue;
    const blend = 'patch' in x ? blendOf(c, x) : undefined;
    if (blend) {
      if (!blended.has(blend.role)) cueMembers(blend);
      blended.add(blend.role);
      continue;
    }
    const r = ready(x);
    if (!r) continue;
    try {
      if ('patch' in r.spec) {
        const solo = cx.only === null || cx.only === x.id;
        out.handles.set(x.id, m.cue(solo ? r.spec : { ...r.spec, weight: 0 }));
        out.patches.set(x.id, r.spec.patch);
      } else {
        const span = 'kind' in x && x.kind === 'span';
        out.groupHandles.set(x.id, span ? m.span(r.spec) : m.owns(r.spec));
      }
    } catch (err) {
      fail(x, 'cue', messageOf(err));
      continue;
    }
    keep(r);
  }
  return out;
}
