import { afterEach, describe, expect, it, vi } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';

interface Part {
  id: number;
}

// A file of its own: the refusal is remembered for the life of the module.
describe('under a content security policy that refuses eval', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks Function once, since each refusal is a violation the browser reports', () => {
    let asked = 0;
    vi.stubGlobal('Function', function refuse() {
      asked++;
      throw new EvalError('refused');
    });
    for (const name of ['refusedA', 'refusedB', 'refusedC']) {
      const m = mix<Part, Record<string, number>>(kit({ [name]: sum(), other: sum() }), {
        lanes: true,
      });
      m.cue({
        patch: keys<Part, Record<string, number>>(1000, [
          { at: 0, delta: { [name]: 0, other: 0 } },
          { at: 1, delta: { [name]: 2, other: 1 } },
        ]),
        loop: true,
      });
      for (const t of [0, 125]) {
        m.sync(t);
        m.probe({ id: 1 });
      }
      m.sync(250);
      expect(m.probe({ id: 1 })).toEqual({ [name]: 0.5, other: 0.25 });
    }
    vi.unstubAllGlobals();
    expect(asked).toBe(1);
  });
});
