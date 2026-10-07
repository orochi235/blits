import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface P {
  x: number;
}
const K = kit<P>({ x: sum() });
const ramp = (ms: number) => patch<string, P>(ms, (ph) => ({ x: ph * 100 }), { writes: ['x'] });

describe('history without a store', () => {
  it('refuses a seek back past what an earlier seek let go', () => {
    const m = mix<string, P>(K, { history: { ms: 500, tape } });
    for (let t = 0; t <= 2000; t += 100) {
      m.sync(t);
      if (t === 300) m.cue({ patch: ramp(1000), subjects: ['a'], loop: false });
    }
    m.seek(1600);
    // 1200 is within 500 of 1600, but the run let go of it at 1500, when it stood at 2000.
    expect(() => m.seek(1200)).toThrow(/older/);
    expect(() => m.project(1200)).toThrow(/older/);
    expect(m.now).toBe(1600);
  });
});
