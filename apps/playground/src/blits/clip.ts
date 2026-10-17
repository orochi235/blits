import type { Handle } from '@msb235/blits';
import { type Clip, type Hatch, MAX_PASSES } from '@pg/widgets/ScoreLanes';
import { periodOf, type Voice } from './composition';
import { compileExpr, type Scope } from './expr';
import { clockOf, type Placed } from './placed';
import type { Subject } from './stage';

/** When the first subject starts after the voice's start, and how long until the last does. */
function spreadOf(
  v: Voice,
  subjects: readonly Subject[],
  scope: Scope,
): { at: number; ms: number } {
  const none = { at: 0, ms: 0 };
  if (!v.stagger) return none;
  const r = compileExpr<(s: Subject) => number>(v.stagger, scope, 0);
  if ('error' in r) return none;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const s of subjects) {
    const d = Number(r.fn(s));
    if (!Number.isFinite(d)) continue;
    first = Math.min(first, d);
    last = Math.max(last, d);
  }
  return Number.isFinite(first) ? { at: first, ms: last - first } : none;
}

export const passesOf = (v: Voice) =>
  v.loop === true ? Number.POSITIVE_INFINITY : v.loop === false ? 1 : v.loop;

export const freezeOf = (v: Voice): Hatch => v.freeze ?? null;

/** Whether the voice plays from somewhere other than its start: a `seek`, or a rate below 0. */
export const startsPartway = (v: Voice) => v.seek !== undefined || v.rate < 0;

/**
 * What a voice of `period` plays on the score at `clock` voice ms per score ms: how long a pass
 * lasts, how many are left from where it starts, and how far into a pass that is. Forward it
 * starts at `seek` or 0 and ends with its last pass; backward it starts at `seek` or its end and
 * ends at 0. At rate 0, and backward with no end to start from, it never ends.
 */
export function playOf(
  period: number,
  clock: number,
  passes: number,
  seek?: number,
): Pick<Clip, 'pass' | 'passes' | 'into'> {
  const open = { pass: 0, passes: Number.POSITIVE_INFINITY };
  if (clock === 0 || period <= 0) return open;
  const pass = period / Math.abs(clock);
  const total = period * passes;
  if (clock < 0) {
    if (!Number.isFinite(total)) return open;
    const from = Math.min(Math.max(seek ?? total, 0), total);
    const behind = from % period;
    return { pass, passes: from / period, ...(behind > 0 ? { into: pass - behind / -clock } : {}) };
  }
  const from = Math.max(seek ?? 0, 0);
  const into = (from % period) / clock;
  const left = Number.isFinite(total) ? Math.max(total - from, 0) / period : passes;
  return { pass, passes: left, ...(into > 0 ? { into } : {}) };
}

/**
 * What is left to play of voice `v` cued partway or backward at each finite `loop` from 1 to
 * `MAX_PASSES`, as `playOf` counts it: the passes its right edge snaps to. Two loops that leave
 * the same give one stop.
 */
export function stopsOf(v: Voice): { loop: number; passes: number }[] {
  const period = periodOf(v.patch) ?? 0;
  const out: { loop: number; passes: number }[] = [];
  if (period <= 0 || v.rate === 0) return out;
  for (let loop = 1; loop <= MAX_PASSES; loop++) {
    const { passes } = playOf(period, v.rate, loop, v.seek);
    const last = out.at(-1)?.passes ?? 0;
    if (passes > last + 1e-9) out.push({ loop, passes });
  }
  return out;
}

/** Voice `v`'s clip, its voice ms drawn as score ms at `clock` voice ms per score ms. */
export function clipOf(
  v: Voice,
  lane: number,
  subjects: readonly Subject[],
  scope: Scope,
  clock: number,
): Clip {
  const freeze = freezeOf(v);
  const spread = spreadOf(v, subjects, scope);
  const k = clock !== 0 ? Math.abs(clock) : 1;
  const clip: Clip = {
    id: v.id,
    lane,
    label: `${v.name} · ${v.patch.kind}${clock < 0 ? ' · backward' : ''}`,
    hue: v.hue,
    start: v.start,
    ...playOf(periodOf(v.patch) ?? 0, clock, passesOf(v), v.seek),
    fadeIn: v.fade.in ?? 0,
    fadeOut: v.fade.out ?? 0,
    spread: spread.ms / k,
    freezeBefore: freeze === 'before' || freeze === 'both',
    freezeAfter: freeze === 'after' || freeze === 'both',
    locked: v.anchor?.start !== undefined || v.anchor?.in !== undefined,
  };
  if (spread.at !== 0) clip.spreadAt = spread.at / k;
  if (startsPartway(v) && clip.pass > 0) clip.stops = stopsOf(v).map((s) => s.passes);
  if (v.locus !== undefined) clip.group = v.locus;
  // blits books no hit of a voice running backward.
  if (v.hits?.length && clock > 0) clip.ticks = v.hits.map((h) => h.at / k);
  return clip;
}

/** A clip where blits put it: its `start` mark, and for a span's child how its fit left it. */
export function placeFrom(clip: Clip, v: Voice, h: Handle<Subject>, p: Placed) {
  if (p.start === undefined) return;
  clip.start = p.start;
  const period = periodOf(v.patch) ?? 0;
  if (p.end === p.start && period > 0 && v.rate > 0) {
    clip.skipped = true;
    Object.assign(clip, playOf(period, v.rate * clockOf(h.owner), clip.passes));
    return;
  }
  const factor = h.rate / v.rate;
  if (Number.isFinite(factor) && Math.abs(factor - 1) > 1e-9) clip.factor = factor;
}
