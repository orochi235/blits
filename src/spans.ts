import { arcEnd } from './arcs.js';
import { elapsedWith, retime } from './clock.js';
import { release } from './fade.js';
import { type Claim, defaultFit, type Fit, layout, type SpanClaim, settle } from './fit.js';
import { reorigin } from './held.js';
import { noted } from './history.js';
import type { Mixer } from './mixer.js';
import { nextFrame } from './move.js';
import { leave } from './origin.js';
import { type Holding, ownerReading, plays } from './owner.js';
import { resolve } from './place.js';
import type { FitResult, SpanSpec, VoiceSpec } from './types.js';
import type { Earlier, Voice } from './voice.js';

/** What a span keeps beside its owner: its claim, its fit, and how the last fit came out. */
export class Fitting {
  readonly budget: number;
  readonly claim: Omit<SpanClaim, 'left'>;
  readonly fit: Fit;
  readonly spill: 'instant' | 'overrun';
  /** Where its children end or its budget does, whichever is later, ms on its own clock. */
  end: number;
  report: FitResult;

  constructor(spec: SpanSpec<unknown>) {
    const budget = spec.duration ?? Number.POSITIVE_INFINITY;
    if (!(budget >= 0)) throw new Error('blits: a span lasts 0 ms or more');
    const share = spec.share ?? 0.5;
    if (!(share >= 0 && share <= 1)) throw new Error('blits: a span staggers by a share in 0..1');
    this.budget = budget;
    this.claim = {
      budget,
      priority: spec.priority ?? 'strong',
      order: spec.order ?? 'queue',
      share,
    };
    this.fit = spec.fit ?? defaultFit;
    this.spill = spec.spill ?? 'instant';
    this.end = Number.isFinite(budget) ? budget : 0;
    this.report = { budget, length: 0, over: 0, skipped: 0, fell: false };
  }
}

/** Refuses a voice a span cannot fit: one it would not own the timing of, or one with no end. */
export function checkChild<I, O>(spec: VoiceSpec<I, O>, child: Voice<I, O>): void {
  if (spec.start !== undefined || spec.anchor?.start !== undefined || spec.anchor?.in !== undefined)
    throw new Error('blits: a span places the voices it holds, so one takes no start of its own');
  if (child.arc !== null) {
    if (!Number.isFinite(arcEnd(child)))
      throw new Error('blits: a span cannot fit an arc held open, which never ends');
  } else if (child.holding !== null) {
    if (child.fitting === null)
      throw new Error('blits: a span holds voices, spans and arcs, not owners');
  } else if (!Number.isFinite(child.span))
    throw new Error('blits: a span cannot fit a voice that never ends');
}

/**
 * Whether a span holds a child its clock ran back to the start of and has not brought back: its
 * layout up to there was made going forward, and stands until the clock passes it again.
 */
function ranBackOver<I, O>(span: Voice<I, O>): boolean {
  for (const child of (span.holding as Holding<Voice<I, O>>).children)
    if (child.out?.stays === true && child.out.back === true) return true;
  return false;
}

/**
 * Puts a child whose owner's clock ran back to before a fit changed its rate, or skipped it, back
 * on the clock it ran on before, so it reads, run back over, what it read going forward; and once
 * the owner's clock reaches that change again, takes the change again, as the layout stands.
 */
export function unfit<I, O>(mix: Mixer<I, O>, child: Voice<I, O>, now: number): void {
  const t = ownerReading(child.owner as Voice<I, O>, now);
  let moved = false;
  for (let e = child.earlier; e !== null && t < child.anchorNow; e = child.earlier) {
    child.later = { ...standing(child), prev: child.later };
    take(child, e);
    child.earlier = e.prev;
    moved = true;
  }
  for (let e = child.later; e !== null && t >= e.anchorNow; e = child.later) {
    child.earlier = { ...standing(child), prev: child.earlier };
    take(child, e);
    child.later = e.prev;
    moved = true;
  }
  if (!moved) return;
  mix.frame = nextFrame();
  reorigin(mix, child, now);
  noted(mix, child);
  mix.lanes?.refill();
}

/** A child's clock as it stands, and whether a fit skipped it. */
function standing<I, O>(c: Voice<I, O>): Omit<Earlier, 'prev'> {
  const { anchorNow, anchorElapsed, rate, ramp, skipped } = c;
  return { anchorNow, anchorElapsed, rate, ramp, skipped };
}

/** Puts a child on a clock it had, which jumps where a fit skipped it on one and not the other. */
function take<I, O>(c: Voice<I, O>, e: Earlier): void {
  c.anchorNow = e.anchorNow;
  c.anchorElapsed = e.anchorElapsed;
  c.rate = e.rate;
  c.ramp = e.ramp;
  if (c.skipped !== e.skipped) c.seeks++;
  c.skipped = e.skipped;
}

/** A span's own clock at mix time `at`, from 0 while it has not started. */
function clockOf<I, O>(span: Voice<I, O>, at: number): number {
  if (Number.isNaN(at)) return 0;
  const t = readingAt(span, at);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/**
 * What a voice's clock reads at mix time `at` through its owners' clocks as they stand, inverting
 * `mixTime`: -Infinity where one yet to start has not reached its start. Unlike `ownerReading`, an
 * owner that has started reads on its clock before its start, where a seek of the owner put a time
 * its children left at.
 */
function readingAt<I, O>(voice: Voice<I, O>, at: number): number {
  const t = voice.owner === null ? at : readingAt(voice.owner, at);
  if (t === Number.NEGATIVE_INFINITY || (voice.state === 'pending' && !(t >= voice.start)))
    return Number.NEGATIVE_INFINITY;
  return elapsedWith(voice, t);
}

/**
 * Whether a child has started, or would have by span ms `by` had a frame come between: a fit from a
 * moment between frames keeps a child whose start that moment had passed where it is.
 */
function begun<I, O>(child: Voice<I, O>, by: number): boolean {
  return child.state !== 'pending' || child.start < by;
}

/** What a child's own clock reads at its span's `local`, 0 while it waits. */
function elapsedIn<I, O>(child: Voice<I, O>, local: number, by: number): number {
  return begun(child, by) ? Math.max(0, elapsedWith(child, local)) : 0;
}

/** How much of a child is left, voice ms at its own clock: what its span still has to fit. */
function leftOf<I, O>(child: Voice<I, O>, local: number, by: number): number {
  const length =
    child.fitting !== null ? child.fitting.end : child.arc !== null ? arcEnd(child) : child.span;
  return Math.max(0, length - elapsedIn(child, local, by));
}

/**
 * Lays out a span's children and fits them into what is left of its budget, from its clock at mix
 * time `from`, default now. Only what is still to come moves: a playing child keeps its place and
 * may change rate, a pending one is placed. A span held by a span is fitted again by its own span
 * after. A span its clock ran back over keeps the layout it made going forward.
 */
export function refit<I, O>(mix: Mixer<I, O>, span: Voice<I, O>, from = mix.now): void {
  const fitting = span.fitting as Fitting;
  if (mix.projecting || span.state === 'done' || ranBackOver(span)) return;
  const local = clockOf(span, from);
  const by = from < mix.now ? local : Number.NEGATIVE_INFINITY;
  const { kids, floors, waiting } = lineUp(mix, span, local, by);
  const claims: Claim[] = kids.map((c, i) => {
    const s = c.spec;
    return {
      floor: floors[i],
      natural: leftOf(c, local, by) / (s.rate ?? 1),
      state: begun(c, by) ? 'playing' : 'pending',
      faster: Math.max(1, s.faster ?? 1),
      slower: Math.max(1, s.slower ?? 1),
      overlap: s.overlap === true,
      ballast: s.ballast === true && c.holding === null,
      priority: s.priority ?? 'weak',
    };
  });
  const claim: SpanClaim = { ...fitting.claim, left: fitting.budget - local };
  const { plan, fell } = settle(claim, claims, fitting.fit, fitting.spill);
  const { at, length } = layout(claim, claims, plan);
  kids.forEach((c, i) => {
    const rate = (c.spec.rate ?? 1) * (plan.rate[i] as number);
    const skipped = (plan.skip[i] as boolean) && c.holding === null;
    const wasSkipped = c.skipped;
    c.skipped = skipped;
    let moved = false;
    if (!begun(c, by)) {
      const start = local + (at[i] as number);
      const elapsed = skipped ? c.span : 0;
      if (c.start !== start || c.rate !== rate || c.anchorElapsed !== elapsed || c.ramp !== null) {
        c.start = start;
        c.anchorNow = start;
        c.anchorElapsed = elapsed;
        c.rate = rate;
        c.ramp = null;
        c.clocks = null;
        c.earlier = null;
        c.later = null;
        moved = true;
      }
    } else {
      if (skipped || c.rate !== rate || c.ramp !== null) {
        c.earlier = { ...standing(c), skipped: wasSkipped, prev: c.earlier };
        c.later = null;
      }
      if (skipped) {
        leave(c, local);
        c.rebase(local);
        c.anchorElapsed = c.span;
        c.seeks++;
        moved = true;
      }
      if (c.rate !== rate || c.ramp !== null) {
        leave(c, local);
        retime(c, local, rate, 0);
        moved = true;
      }
    }
    if (moved) {
      mix.frame = nextFrame();
      reorigin(mix, c, mix.now);
      noted(mix, c);
    }
  });
  for (const c of waiting) {
    if (c.start === Number.POSITIVE_INFINITY) continue;
    c.start = Number.POSITIVE_INFINITY;
    c.anchorNow = Number.POSITIVE_INFINITY;
    c.anchorElapsed = 0;
    c.clocks = null;
    c.earlier = null;
    c.later = null;
    mix.frame = nextFrame();
    reorigin(mix, c, mix.now);
    noted(mix, c);
  }
  if (kids.length > 0) mix.lanes?.refill();
  const reach = local + length;
  const over = Number.isFinite(fitting.budget) ? Math.max(0, reach - fitting.budget) : 0;
  const within = over < 1e-6;
  const end = !Number.isFinite(fitting.budget) ? reach : within ? fitting.budget : reach;
  fitting.report = {
    budget: fitting.budget,
    length: reach,
    over: within ? 0 : over,
    skipped: plan.skip.filter((s, i) => s && kids[i]?.holding === null).length,
    fell,
  };
  if (end !== fitting.end) {
    fitting.end = end;
    noted(mix, span);
    if (span.owner?.fitting) refit(mix, span.owner, from);
  }
}

/**
 * A span's children still to fit, in the order it lays them out: those playing first, as cued, then
 * those still to start by rank. Each pending one's floor is where its `earliest` answers, span ms
 * from `local`, and before `local` only in the frame it was cued. One whose anchor has no answer yet waits unplaced, and under `queue` or `stagger`
 * so does every child after it, since each is laid out from the one before.
 */
function lineUp<I, O>(
  mix: Mixer<I, O>,
  span: Voice<I, O>,
  local: number,
  by: number,
): { kids: Voice<I, O>[]; floors: (number | undefined)[]; waiting: Voice<I, O>[] } {
  // A child fading, or kept quiet past its passes, has nothing left to fit.
  const live = (span.holding?.children ?? []).filter(
    (c) => c.state !== 'done' && c.state !== 'frozen' && c.out === null && leftOf(c, local, by) > 0,
  );
  const kids = live.filter((c) => begun(c, by));
  const floors: (number | undefined)[] = kids.map(() => undefined);
  const waiting: Voice<I, O>[] = [];
  const pending = live
    .filter((c) => !begun(c, by))
    .sort((a, b) => (a.spec.rank ?? 0) - (b.spec.rank ?? 0));
  const chained = (span.fitting as Fitting).claim.order !== 'together';
  for (const c of pending) {
    const e = c.spec.earliest;
    const t = e === undefined ? undefined : resolve(mix, e, c, Number.NEGATIVE_INFINITY);
    c.floorSeen = t ?? Number.NaN;
    if ((e !== undefined && t === undefined) || (chained && waiting.length > 0)) {
      waiting.push(c);
      continue;
    }
    kids.push(c);
    // An anchor that answered before the span began has no time on its clock: no bound.
    const floor = t === undefined || t === Number.NEGATIVE_INFINITY ? undefined : t - local;
    // A past floor places a child only as it is cued: one waiting since waits on those before it.
    floors.push(
      floor === undefined || c.cuedSeq === mix.transport.seq ? floor : Math.max(0, floor),
    );
  }
  return { kids, floors, waiting };
}

/**
 * Fits again each span with a child still to start whose anchored `earliest` answers differently
 * than at its last fit: an anchor that has come to have an answer, or moved.
 */
export function refloor<I, O>(mix: Mixer<I, O>): void {
  if (mix.projecting) return;
  for (const span of mix.owners ?? []) {
    if (span.fitting === null || span.state === 'done') continue;
    const moved = (span.holding?.children ?? []).some((c) => {
      const e = c.spec.earliest;
      if (c.state !== 'pending' || e === undefined || typeof e === 'number') return false;
      const t = resolve(mix, e, c, Number.NEGATIVE_INFINITY) ?? Number.NaN;
      return !Object.is(t, c.floorSeen);
    });
    if (moved) refit(mix, span);
  }
}

/** Whether a span whose last child just left at mix time `at` stays, its budget not yet out. */
export function lingers<I, O>(span: Voice<I, O>, at: number): boolean {
  const f = span.fitting;
  return f !== null && Number.isFinite(f.budget) && ownerReading(span, at) < f.budget;
}

/**
 * Lets the spans out of budget that hold no child still playing leave, at the moment their budget
 * ran out, or, under history, stay quiet with an owner holding them.
 */
export function lapse<I, O>(mix: Mixer<I, O>, now: number): void {
  for (const span of mix.owners ?? []) {
    const f = span.fitting;
    if (f === null || span.state === 'done' || span.out?.stays || !Number.isFinite(f.budget))
      continue;
    if (plays(span, now)) continue;
    if (ownerReading(span, now) >= f.budget) release(mix, span, span.timeAt(f.budget));
  }
}

/** Fits every span again, as after a seek put its children back. */
export function refitAll<I, O>(mix: Mixer<I, O>): void {
  const spans = (mix.owners ?? []).filter((v) => v.fitting !== null);
  // Later cued first, so a span held by a span is fitted before the one holding it.
  for (let i = spans.length - 1; i >= 0; i--) refit(mix, spans[i] as Voice<I, O>);
}
