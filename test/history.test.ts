import { describe, expect, it } from 'vitest';
import { copyHeld, copyHeldInto, recordInput } from '../src/history.js';
import { wholeRecord } from '../src/record.js';
import type { Subject } from '../src/subject.js';

/** A record with every field holding a value of its own, none the one `record` starts it at. */
function full(): Subject<unknown> {
  const h = wholeRecord({ id: 1 }, true, { x: 1 });
  let n = 1;
  for (const key of Object.keys(h) as (keyof Subject<unknown>)[]) {
    const v = h[key];
    if (typeof v === 'number') (h as unknown as Record<string, unknown>)[key] = n++ + 0.5;
  }
  h.reaches = false;
  h.copied = true;
  h.bands = new Uint8Array([1, 2]);
  h.delta = { gain: 1 };
  h.base = { gain: 2 };
  h.slope = { gain: 3 };
  h.kept = new Map([[{}, { y: 4 }]]);
  h.unkept = [{ z: 5 }];
  h.snaps = [];
  h.from = 6.5;
  h.unknown = true;
  h.inputs = [];
  h.replay = [];
  h.next = wholeRecord(null, true, undefined);
  h.roles = new Map();
  return h;
}

describe('copyHeldInto', () => {
  for (const shared of [false, true])
    it(`writes every field copyHeld copies${shared ? ', sharing the state' : ''}`, () => {
      const h = full();
      const voice = { patch: {} } as never;
      const copy = copyHeld(voice, h, shared);
      const into = wholeRecord(null, true, undefined);
      const out = copyHeldInto(voice, h, into, shared);
      expect(out).toBe(into);
      expect(Object.keys(out)).toEqual(Object.keys(copy));
      expect(out).toEqual(copy);
      if (shared) expect(out.state).toBe(h.state);
      else expect(out.state).not.toBe(h.state);
      expect(out.base).not.toBe(h.base);
      expect(out.kept).not.toBe(h.kept);
    });

  it('leaves nothing of a reused record behind, its trail row included', () => {
    const h = full();
    const voice = { patch: {} } as never;
    const into = full();
    into.probeRow = 3;
    into.probeEpoch = 7;
    expect(copyHeldInto(voice, h, into)).toEqual(copyHeld(voice, h));
  });
});

describe('recordInput', () => {
  it('stamps a value read again at the same mix time with the frame that read it', () => {
    const transport = { seq: 10, pager: null };
    const m = {
      opts: { history: { ms: 1000, inputs: true } },
      projecting: false,
      now: 500,
      transport,
    };
    const h = wholeRecord(null, true, undefined);
    recordInput(m as never, {} as never, 's', h, 0.2);
    transport.seq = 11;
    recordInput(m as never, {} as never, 's', h, 0.8);
    expect(h.inputs).toEqual([{ at: 500, seq: 11, value: 0.8 }]);
  });
});
