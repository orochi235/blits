import { compile } from '@pg/blits/compile';
import { FRAME } from '@pg/blits/frame';
import { Player } from '@pg/blits/player';
import { readBack, restOf, traceAhead } from '@pg/blits/readBack';
import { describe, expect, it } from 'vitest';
import { comp, subjects, voice } from './helpers';

const c = comp([
  voice({
    id: 'a',
    loop: 1,
    patch: {
      kind: 'keys',
      period: 1000,
      stops: [
        { at: 0, delta: { turn: 0 } },
        { at: 1, delta: { turn: 90 } },
      ],
      ease: 'linear',
    },
  }),
]);
const s = subjects[0] as (typeof subjects)[0];
const player = () => new Player(() => compile(c, subjects), subjects);

describe('readBack', () => {
  it('reads a past frame as play showed it', () => {
    const p = player();
    p.seek(10 * FRAME);
    const then = p.built.mix.probe(s).turn;
    const at = p.built.mix.now;
    p.seek(40 * FRAME);
    const r = readBack(p.built.mix, s, at);
    if ('error' in r) throw new Error(r.error);
    expect(r.pose.turn).toBe(then);
    expect(r.doubts.turn).toBeDefined();
  });

  it('says why where history cannot reach', () => {
    const p = player();
    p.seek(10 * FRAME);
    expect(readBack(p.built.mix, s, -5000)).toHaveProperty('error');
  });
});

describe('traceAhead', () => {
  it('reads a linear keys voice exactly, ending where play lands', () => {
    const p = player();
    p.seek(10 * FRAME);
    const t = traceAhead(p.built.mix, s, 300);
    if ('error' in t) throw new Error(t.error);
    const run = t.runs.turn;
    expect(run.exact).toBe(true);
    expect(run.at[0]).toBe(t.from);
    expect(run.at.at(-1)).toBe(t.to);
    expect(run.value.at(-1)).toBeCloseTo((t.to / 1000) * 90, 6);
  });
});

describe('restOf', () => {
  it('is at rest and inert once the voice is done', () => {
    const p = player();
    p.seek(10 * FRAME);
    expect(restOf(p.built.mix, s)).toEqual({ atRest: false, inert: false });
    p.seek(1500);
    expect(restOf(p.built.mix, s)).toEqual({ atRest: true, inert: true });
  });
});
