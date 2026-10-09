import { elapsedWith, retime } from './clock.js';
import { retire } from './fade.js';
import { type Claim, defaultFit, type Fit, layout, type SpanClaim, settle } from './fit.js';
import { reorigin } from './held.js';
import { noted } from './history.js';
import type { Mixer } from './mixer.js';
import { nextFrame } from './move.js';
import { leave } from './origin.js';
import { ownerReading } from './owner.js';
import type { FitResult, SpanSpec, VoiceSpec } from './types.js';
import type { Voice } from './voice.js';

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
  if (child.holding !== null) {
    if (child.fitting === null) throw new Error('blits: a span holds voices and spans, not owners');
  } else if (!Number.isFinite(child.span))
    throw new Error('blits: a span cannot fit a voice that never ends');
}

/** A span's own clock at the mix's now, from 0 while it has not started. */
function clockOf<I, O>(mix: Mixer<I, O>, span: Voice<I, O>): number {
  if (Number.isNaN(mix.now)) return 0;
  const t = ownerReading(span, mix.now);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** What a child's own clock reads at its span's `local`, 0 while it waits. */
function elapsedIn<I, O>(child: Voice<I, O>, local: number): number {
  return child.state === 'pending' ? 0 : Math.max(0, elapsedWith(child, local));
}

/** How much of a child is left, voice ms at its own clock: what its span still has to fit. */
function leftOf<I, O>(child: Voice<I, O>, local: number): number {
  const length = child.fitting !== null ? child.fitting.end : child.span;
  return Math.max(0, length - elapsedIn(child, local));
}

/**
 * Lays out a span's children and fits them into what is left of its budget, from its clock now.
 * Only what is still to come moves: a playing child keeps its place and may change rate, a
 * pending one is placed. A span held by a span is fitted again by its own span after.
 */
export function refit<I, O>(mix: Mixer<I, O>, span: Voice<I, O>): void {
  const fitting = span.fitting as Fitting;
  if (mix.projecting || span.state === 'done') return;
  const local = clockOf(mix, span);
  const kids = (span.holding?.children ?? []).filter(
    (c) =>
      c.state !== 'done' && c.state !== 'frozen' && c.state !== 'fading' && leftOf(c, local) > 0,
  );
  const claims: Claim[] = kids.map((c) => {
    const s = c.spec;
    return {
      natural: leftOf(c, local) / (s.rate ?? 1),
      state: c.state === 'pending' ? 'pending' : 'playing',
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
    let moved = false;
    if (c.state === 'pending') {
      const start = local + (at[i] as number);
      const elapsed = skipped ? c.span : 0;
      if (c.start !== start || c.rate !== rate || c.anchorElapsed !== elapsed || c.ramp !== null) {
        c.start = start;
        c.anchorNow = start;
        c.anchorElapsed = elapsed;
        c.rate = rate;
        c.ramp = null;
        c.clocks = null;
        moved = true;
      }
    } else {
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
    if (span.owner?.fitting) refit(mix, span.owner);
  }
}

/** Whether a span whose last child just left at mix time `at` stays, its budget not yet out. */
export function lingers<I, O>(span: Voice<I, O>, at: number): boolean {
  const f = span.fitting;
  return f !== null && Number.isFinite(f.budget) && ownerReading(span, at) < f.budget;
}

/** Lets the spans that are empty and out of budget leave, at the moment their budget ran out. */
export function lapse<I, O>(mix: Mixer<I, O>, now: number): void {
  for (const span of mix.owners ?? []) {
    const f = span.fitting;
    if (f === null || span.state === 'done' || !Number.isFinite(f.budget)) continue;
    if ((span.holding?.children.length ?? 0) > 0) continue;
    if (ownerReading(span, now) >= f.budget) retire(mix, span, span.timeAt(f.budget));
  }
}

/** Fits every span again, as after a seek put its children back. */
export function refitAll<I, O>(mix: Mixer<I, O>): void {
  const spans = (mix.owners ?? []).filter((v) => v.fitting !== null);
  // Later cued first, so a span held by a span is fitted before the one holding it.
  for (let i = spans.length - 1; i >= 0; i--) refit(mix, spans[i] as Voice<I, O>);
}
