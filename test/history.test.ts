import { describe, expect, it } from 'vitest';
import { copyHeld, copyHeldInto } from '../src/history.js';
import { record } from '../src/record.js';
import type { Subject } from '../src/voice.js';

/** A record with every field holding a value of its own, none the one `record` starts it at. */
function full(): Subject<unknown> {
  const h = record({ id: 1 }, true, { x: 1 });
  let n = 1;
  for (const key of Object.keys(h) as (keyof Subject<unknown>)[]) {
    const v = h[key];
    if (typeof v === 'number') (h as unknown as Record<string, unknown>)[key] = n++ + 0.5;
  }
  h.reaches = false;
  h.rested = true;
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
  h.next = record(null, true, undefined);
  h.loci = new Map();
  return h;
}

describe('copyHeldInto', () => {
  it('writes every field copyHeld copies, keeping the slot and seek stamp of the record it writes over', () => {
    const h = full();
    const voice = { patch: {} } as never;
    const copy = copyHeld(voice, h, true);
    const into = record(null, true, undefined);
    into.slot = 41;
    into.restored = 42;
    const out = copyHeldInto(h, into);
    expect(out).toBe(into);
    expect(Object.keys(out)).toEqual(Object.keys(copy));
    expect({ ...out, slot: copy.slot, restored: copy.restored }).toEqual(copy);
    expect(out.slot).toBe(41);
    expect(out.restored).toBe(42);
    expect(out.state).toBe(h.state);
    expect(out.base).not.toBe(h.base);
    expect(out.kept).not.toBe(h.kept);
  });
});
