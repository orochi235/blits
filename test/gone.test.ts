import { describe, expect, it } from 'vitest';
import { expireGone, GoneIndex } from '../src/gone.js';

/** The part of a mix `expireGone` reads and writes, over gone voices finished at `reached`. */
const stub = (reached: number[]) => {
  const gone = reached.map((reachedTo) => ({ reachedTo, doneAt: reachedTo, named: null, spec: {} }));
  return {
    gone,
    goneIx: new GoneIndex(),
    parters: new Set(),
    departed: { add() {} },
    transport: { forgotTo: Number.NEGATIVE_INFINITY },
    scored: { gone: null },
  };
};

describe('expireGone', () => {
  it('lets go of the voices finished before the reach, keeping the rest in order', () => {
    const mix = stub([50, 3, 20, 1, 60]);
    expireGone(mix as never, 10);
    expect(mix.gone.map((v) => v.reachedTo)).toEqual([50, 20, 60]);
  });

  it('keeps more voices at the front than a call can take arguments', () => {
    const n = 300_000;
    const reached = [n + 1, 0];
    for (let i = 1; i <= n; i++) reached.push(i);
    const mix = stub(reached);
    expireGone(mix as never, 1);
    expect(mix.gone.length).toBe(n + 1);
    expect(mix.gone[0]?.reachedTo).toBe(n + 1);
    expect(mix.gone[n]?.reachedTo).toBe(n);
  });
});
