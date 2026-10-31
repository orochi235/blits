import { describe, expect, test } from 'vitest';
import { kit, last, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import { level } from '../src/signals.js';

interface S {
  id: string;
}
const a: S = { id: 'a' };

// fold.ts `foldWith` turns a rest-less channel's band off (`unband`) whenever a voice's weight is
// not above 0, delta or no delta. roles.ts `foldRoles` skips that for a voice whose delta is null,
// which is every fn voice at weight 0, so once any role voice is in the mix the band's hysteresis
// survives a frame at weight 0 and a weight back between `off` and `on` finds it still on.
describe('a band switched off by a frame at weight 0 stays off between off and on', () => {
  for (const lanes of [true, false])
    test(`with a role voice elsewhere in the mix, lanes ${lanes}`, () => {
      const m = mix<S, { tag: string; g: number }>(kit({ tag: last<string>(), g: sum() }), {
        band: { on: 0.5, off: 0.2 },
        lanes,
      });
      const k = level<S>(1);
      m.cue({ patch: patch(0, () => ({ tag: 'on' }), { writes: ['tag'] }), weight: k });
      // Only its presence matters: it sends every fold of the mix down `foldRoles`.
      m.cue({ patch: patch(0, () => ({ g: 1 }), { writes: ['g'] }), role: 'r' });
      const seen: unknown[] = [];
      let t = 0;
      for (const w of [1, 0, 0.3]) {
        k.set(w);
        t += 16;
        m.sync(t);
        seen.push(m.probe(a).tag);
      }
      // Without the role voice this reads ['on', undefined, undefined].
      expect(seen).toEqual(['on', undefined, undefined]);
    });

  // A role's band is reset (`bands.get(name)?.fill(2)`) only when the role forms a group, which
  // needs a member with a delta. A keys member reads at weight 0 and passes; an fn member does not.
  for (const lanes of [true, false])
    test(`an fn role member, lanes ${lanes}`, () => {
      const m = mix<S, { tag: string }>(kit({ tag: last<string>() }), {
        band: { on: 0.5, off: 0.2 },
        lanes,
      });
      const k = level<S>(1);
      m.cue({ patch: patch(0, () => ({ tag: 'on' }), { writes: ['tag'] }), weight: k, role: 'r' });
      const seen: unknown[] = [];
      let t = 0;
      for (const w of [1, 0, 0.3]) {
        k.set(w);
        t += 16;
        m.sync(t);
        seen.push(m.probe(a).tag);
      }
      // The same voice as a keys patch reads ['on', undefined, undefined].
      expect(seen).toEqual(['on', undefined, undefined]);
    });
});

// contribution.ts reads a keys voice in a role at weight 0 "having a delta makes it a member, and
// the role folds at its first member's place". An fn member at weight 0 is not read, so the role
// folds at a later member's place instead, and on an order-sensitive channel the pose depends on
// the members' patch form.
describe('a role folds at its first member’s place whatever the members’ form', () => {
  for (const lanes of [true, false])
    test(`lanes ${lanes}`, () => {
      const read = (form: 'fn' | 'keys') => {
        const m = mix<S, { t: string }>(kit({ t: last<string>() }), { lanes });
        const w = (v: string) =>
          form === 'fn'
            ? patch<S, { t: string }>(0, () => ({ t: v }), { writes: ['t'] })
            : keys<S, { t: string }>(1000, [{ at: 0, delta: { t: v } }]);
        m.cue({ patch: w('A'), role: 'r', weight: 0, loop: true });
        m.cue({ patch: w('B'), loop: true });
        m.cue({ patch: w('C'), role: 'r', loop: true });
        m.sync(16);
        return m.probe(a).t;
      };
      // keys: the role folds at A's place, before B, and B wins. fn: at C's, after B, and C wins.
      expect(read('fn')).toBe(read('keys'));
    });
});
