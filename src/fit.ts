/**
 * How hard a claim on time holds when it meets another: the weaker gives way.
 *
 * @category score
 */
export type Strength = 'weak' | 'strong' | 'required';

/**
 * How a span lays its children out: each after the one before has ended, partway through it, or
 * all at once.
 *
 * @category score
 */
export type Order = 'queue' | 'stagger' | 'together';

/**
 * One child of a span as a fit sees it: what is left of it, and the ways it may give way.
 *
 * @category score
 */
export interface Claim {
  /** Span ms left of it at its own rate. */
  natural: number;
  /** A playing child has started, and stays at the front. */
  state: 'pending' | 'playing';
  /** How many times faster it may play; 1 for no faster. */
  faster: number;
  /** How many times slower it may play; 1 for no slower. */
  slower: number;
  /** Whether it may run alongside the one before it where the span's order would not have it. */
  overlap: boolean;
  /** Whether it may jump to its end instead of playing. */
  skip: boolean;
  priority: Strength;
}

/**
 * The span as a fit sees it.
 *
 * @category score
 */
export interface SpanClaim {
  /** Span ms left of its budget; Infinity for a span with none. */
  left: number;
  /** Its whole budget. */
  budget: number;
  priority: Strength;
  order: Order;
  /** How far through the one before a staggered child starts, 0..1. */
  share: number;
}

/**
 * What a fit decides, per child in the order given: a rate over its own, and whether it is
 * skipped. `share` is how far through the one before a child that may overlap starts, and `allow`
 * the span ms the span may run past its budget.
 *
 * @category score
 */
export interface FitPlan {
  rate: number[];
  skip: boolean[];
  share: number;
  allow: number;
}

/**
 * A strategy for fitting a span's children into its budget: from the plan so far to a new one.
 *
 * @category score
 */
export type Fit = (span: SpanClaim, kids: readonly Claim[], plan: FitPlan) => FitPlan;

/** How far through the one before a child starts under each order, before any fit. */
export function shareOf(order: Order, stagger: number): number {
  return order === 'queue' ? 1 : order === 'together' ? 0 : stagger;
}

/**
 * The plan before any fit: every child at its own rate, played, in the span's order.
 *
 * @category score
 */
export function plain(span: SpanClaim, kids: readonly Claim[]): FitPlan {
  return {
    rate: kids.map(() => 1),
    skip: kids.map(() => false),
    share: shareOf(span.order, span.share),
    allow: 0,
  };
}

/**
 * Where a plan puts each child, span ms from now, and how long they take together. A playing child
 * is where it is, at 0; each pending one starts its share through the one before it.
 *
 * @category score
 */
export function layout(
  span: SpanClaim,
  kids: readonly Claim[],
  plan: FitPlan,
): { at: number[]; length: number } {
  const base = shareOf(span.order, span.share);
  const at: number[] = [];
  let length = 0;
  let prevAt = 0;
  let prevLen = 0;
  kids.forEach((k, i) => {
    const len = plan.skip[i] ? 0 : k.natural / (plan.rate[i] as number);
    const t =
      k.state === 'playing' || i === 0
        ? 0
        : prevAt + (k.overlap ? Math.min(plan.share, base) : base) * prevLen;
    at.push(t);
    length = Math.max(length, t + len);
    prevAt = t;
    prevLen = len;
  });
  return { at, length };
}

const fits = (span: SpanClaim, kids: readonly Claim[], plan: FitPlan): boolean =>
  layout(span, kids, plan).length <= span.left + plan.allow + 1e-9;

/** The smallest value in `lo..hi` at which `ok` holds, where it holds from some point up. */
function least(lo: number, hi: number, ok: (x: number) => boolean): number {
  if (ok(lo)) return lo;
  if (!ok(hi)) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Moves every child's rate by one factor toward the budget, before the span's fit: faster where
 * they run past it, each no faster than its `faster` allows, and slower where they leave room in
 * it, each no slower than its `slower` allows, so they fill it.
 */
export function rescale(span: SpanClaim, kids: readonly Claim[], plan: FitPlan): FitPlan {
  if (!fits(span, kids, plan)) {
    const top = Math.max(1, ...kids.map((k) => k.faster));
    const at = (f: number): FitPlan => ({
      ...plan,
      rate: kids.map((k, i) => Math.max(plan.rate[i] as number, Math.min(f, k.faster))),
    });
    return at(least(1, top, (f) => fits(span, kids, at(f))));
  }
  if (!Number.isFinite(span.left)) return plan;
  const top = Math.max(1, ...kids.map((k) => k.slower));
  if (top === 1) return plan;
  const at = (f: number): FitPlan => ({
    ...plan,
    rate: kids.map((k, i) => (plan.rate[i] as number) / Math.min(f, k.slower)),
  });
  // The largest factor that still fits: `least` over the factors that do not.
  const f = least(1, top, (x) => !fits(span, kids, at(x)));
  return fits(span, kids, at(f)) ? at(f) : at(Math.max(1, f - 1e-9));
}

/**
 * Starts children that may overlap sooner after the one before, toward all at once, until they
 * fit.
 *
 * @category score
 */
export function condense(): Fit {
  return (span, kids, plan) => {
    if (fits(span, kids, plan) || !kids.some((k) => k.overlap)) return plan;
    const at = (s: number): FitPlan => ({ ...plan, share: s });
    // `least` finds the smallest x that fits; the share wanted is the largest, so search 1 - share.
    const x = least(0, plan.share, (d) => fits(span, kids, at(plan.share - d)));
    return at(plan.share - x);
  };
}

/**
 * Jumps children that may be skipped to their end, latest first, until they fit.
 *
 * @category score
 */
export function shed(): Fit {
  return (span, kids, plan) => {
    let p = plan;
    for (let i = kids.length - 1; i >= 0 && !fits(span, kids, p); i--) {
      if (!(kids[i] as Claim).skip || p.skip[i]) continue;
      const s = p.skip.slice();
      s[i] = true;
      p = { ...p, skip: s };
    }
    return p;
  };
}

/**
 * Jumps every child left to its end at once, whether or not it fits otherwise.
 *
 * @category score
 */
export function conclude(): Fit {
  return (_span, kids, plan) => ({ ...plan, skip: kids.map(() => true) });
}

/**
 * Lets the span run past its budget: up to `cap` times it, or without limit.
 *
 * @category score
 */
export function overrun(opts: { cap?: number } = {}): Fit {
  return (span, _kids, plan) => {
    const cap = opts.cap;
    const allow =
      cap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, (cap - 1) * span.budget);
    return { ...plan, allow: Math.max(plan.allow, allow) };
  };
}

/**
 * Tries each fit in turn, handing the plan on, and stops once the children fit.
 *
 * @category score
 */
export function pipe(...fits_: readonly Fit[]): Fit {
  return (span, kids, plan) => {
    let p = plan;
    for (const f of fits_) {
      if (fits(span, kids, p)) break;
      p = f(span, kids, p);
    }
    return p;
  };
}

/**
 * Every way of giving way after the span's retiming, overrunning only once the rest are spent.
 *
 * @category score
 */
export function lax(opts: { cap?: number } = {}): Fit {
  return pipe(condense(), shed(), overrun(opts));
}

/** The fit a span takes without one of its own. */
export const defaultFit: Fit = pipe(condense(), shed());

const rank = { weak: 0, strong: 1, required: 2 } as const;

/**
 * A span's fit settled: the plan, and what it had to do past the strategy, which starts from the
 * children retimed toward the budget. Where the children still
 * do not fit, a span weaker than `strong` lets them run long; otherwise `spill` either skips
 * every child weaker than the span (`instant`), or lets them run long (`overrun`).
 */
export function settle(
  span: SpanClaim,
  kids: readonly Claim[],
  fit: Fit,
  spill: 'instant' | 'overrun',
): { plan: FitPlan; fell: boolean } {
  let plan = fit(span, kids, rescale(span, kids, plain(span, kids)));
  if (fits(span, kids, plan) || rank[span.priority] === 0 || spill === 'overrun')
    return { plan, fell: !fits(span, kids, plan) && rank[span.priority] > 0 };
  plan = {
    ...plan,
    skip: kids.map((k, i) => (plan.skip[i] as boolean) || rank[k.priority] < rank[span.priority]),
  };
  return { plan, fell: true };
}
