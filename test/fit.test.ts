import { describe, expect, it } from 'vitest';
import {
  type Claim,
  chain,
  collapse,
  defaultFit,
  layout,
  lenient,
  overlap,
  overrun,
  plain,
  retime,
  type SpanClaim,
  settle,
  skip,
} from '../src/fit.js';

const kid = (natural: number, hints: Partial<Claim> = {}): Claim => ({
  natural,
  state: 'pending',
  faster: 1,
  slower: 1,
  overlap: false,
  skip: false,
  firm: 'weak',
  ...hints,
});

const span = (left: number, more: Partial<SpanClaim> = {}): SpanClaim => ({
  left,
  budget: left,
  firm: 'strong',
  order: 'queue',
  share: 0.5,
  ...more,
});

const length = (s: SpanClaim, kids: Claim[], fit = defaultFit) =>
  layout(s, kids, fit(s, kids, plain(s, kids))).length;

describe('layout', () => {
  it('queues, staggers and runs together', () => {
    const kids = [kid(100), kid(100), kid(100)];
    expect(layout(span(1000), kids, plain(span(1000), kids)).at).toEqual([0, 100, 200]);
    const st = span(1000, { order: 'stagger' });
    expect(layout(st, kids, plain(st, kids)).at).toEqual([0, 50, 100]);
    const tg = span(1000, { order: 'together' });
    expect(layout(tg, kids, plain(tg, kids)).length).toBe(100);
  });

  it('keeps a playing child at the front and queues the rest after what is left of it', () => {
    const kids = [kid(40, { state: 'playing' }), kid(100)];
    expect(layout(span(1000), kids, plain(span(1000), kids)).at).toEqual([0, 40]);
  });
});

describe('strategies', () => {
  it('retimes faster evenly, each child no faster than it allows', () => {
    const s = span(200);
    const kids = [kid(200, { faster: 4 }), kid(200, { faster: 4 })];
    expect(layout(s, kids, retime(s, kids, plain(s, kids))).length).toBeCloseTo(200);
    const capped = [kid(200, { faster: 4 }), kid(200, { faster: 1.25 })];
    const p = retime(s, capped, plain(s, capped));
    expect(p.rate[1]).toBe(1.25);
    expect(layout(s, capped, p).length).toBeGreaterThan(200);
  });

  it('overlaps only the children that allow it', () => {
    const s = span(150);
    const kids = [kid(100), kid(100, { overlap: true })];
    expect(length(s, kids, overlap())).toBeCloseTo(150);
    const stiff = [kid(100), kid(100)];
    expect(length(s, stiff, overlap())).toBe(200);
  });

  it('skips the latest children that allow it, until the rest fit', () => {
    const s = span(250);
    const kids = [kid(100, { skip: true }), kid(100, { skip: true }), kid(100, { skip: true })];
    const p = skip()(s, kids, plain(s, kids));
    expect(p.skip).toEqual([false, false, true]);
  });

  it('collapses every child to an instant', () => {
    const s = span(250);
    const kids = [kid(100), kid(100)];
    expect(length(s, kids, collapse())).toBe(0);
  });

  it('retimes slower to fill the budget, each child no slower than it allows', () => {
    const s = span(400);
    const kids = [kid(100, { slower: 4 }), kid(100, { slower: 4 })];
    expect(layout(s, kids, retime(s, kids, plain(s, kids))).length).toBeCloseTo(400, 3);
    const some = [kid(100, { slower: 1.5 }), kid(100)];
    expect(layout(s, some, retime(s, some, plain(s, some))).length).toBeCloseTo(250, 3);
    const stiff = [kid(100), kid(100)];
    expect(retime(s, stiff, plain(s, stiff)).rate).toEqual([1, 1]);
  });

  it('retimes before any fit, so a chain with room still fills the budget', () => {
    const s = span(400);
    const kids = [kid(100, { slower: 4, skip: true }), kid(100, { slower: 4, skip: true })];
    const { plan } = settle(s, kids, defaultFit, 'instant');
    expect(plan.skip).toEqual([false, false]);
    expect(layout(s, kids, plan).length).toBeCloseTo(400, 3);
  });

  it('overruns up to a cap, or without one', () => {
    const s = span(100);
    const kids = [kid(300)];
    expect(overrun({ cap: 1.5 })(s, kids, plain(s, kids)).allow).toBe(50);
    expect(overrun()(s, kids, plain(s, kids)).allow).toBe(Number.POSITIVE_INFINITY);
  });

  it('chains strategies, stopping once the children fit', () => {
    const s = span(100);
    const kids = [kid(100, { faster: 2, skip: true }), kid(100, { faster: 2, skip: true })];
    const p = chain(overlap(), skip())(s, kids, retime(s, kids, plain(s, kids)));
    expect(p.skip).toEqual([false, false]);
    expect(layout(s, kids, p).length).toBeCloseTo(100);
  });

  it('lenient gives every way before it overruns', () => {
    const s = span(100);
    const kids = [kid(400, { faster: 2 })];
    const p = lenient({ cap: 2 })(s, kids, retime(s, kids, plain(s, kids)));
    expect(p.rate[0]).toBe(2);
    expect(p.allow).toBe(100);
  });
});

describe('settle', () => {
  it('collapses the children weaker than the span when nothing else fits', () => {
    const s = span(100);
    const kids = [kid(300), kid(300, { firm: 'required' })];
    const { plan, fell } = settle(s, kids, defaultFit, 'instant');
    expect(fell).toBe(true);
    expect(plan.skip).toEqual([true, false]);
  });

  it('runs long instead under overrun, or for a weak span, saying so only for the first', () => {
    const kids = [kid(300)];
    expect(settle(span(100), kids, defaultFit, 'overrun')).toMatchObject({
      fell: true,
      plan: { skip: [false] },
    });
    expect(settle(span(100, { firm: 'weak' }), kids, defaultFit, 'instant')).toMatchObject({
      fell: false,
      plan: { skip: [false] },
    });
  });

  it('leaves children that fit alone', () => {
    expect(settle(span(500), [kid(100), kid(100)], defaultFit, 'instant').fell).toBe(false);
  });
});
