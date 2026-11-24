import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, last, sum } from '../src/channels.js';
import { color, oklab } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import { memoryStore } from './store.js';

interface Pose {
  x: number;
  tint: number[];
}
interface Part {
  id: number;
}
const RED = oklab(0xff0000);
const parts: Part[] = Array.from({ length: 8 }, (_, id) => ({ id }));

const patches = {
  fn: () => patch<Part, Pose>(1000, () => ({ tint: RED }), { writes: ['tint'] }),
  keys: () =>
    keys<Part, Pose>(1000, [
      { at: 0, delta: { tint: RED } },
      { at: 1, delta: { tint: RED } },
    ]),
};

// A weight per frame. 0.5 is inside the default band, where the channel stays as it was.
const plans = {
  'falls to 0 and comes back inside the band': [1, 1, 0, 0, 0.5, 0.5],
  'falls through the band to 0 and comes back inside it': [1, 0.5, 0, 0.5, 0.5],
};

/** What each frame shows of `tint`, a frame at weight 0 read or not. */
function run(
  lanes: boolean,
  kind: keyof typeof patches,
  plan: number[],
  read: 'probe' | 'pull',
  skip: boolean,
) {
  const m = mix<Part, Pose>(kit<Pose>({ x: sum(), tint: color(last()) }), { lanes });
  let w = 1;
  m.sync(0);
  m.cue({ patch: patches[kind](), weight: () => w });
  m.cue({ patch: patch<Part, Pose>(1000, () => ({ x: 1 }), { writes: ['x'] }) });
  const seen: string[] = [];
  plan.forEach((weight, i) => {
    w = weight;
    m.sync(16 * (i + 1));
    if (skip && weight === 0) return;
    if (read === 'probe') seen.push(JSON.stringify(parts.map((s) => m.probe(s).tint)));
    else {
      const out = { tint: new Float64Array(parts.length * 4), x: new Float64Array(parts.length) };
      m.pull(parts, out);
      seen.push(out.tint.join());
    }
  });
  return seen;
}

describe('a rest-less channel on a lane', () => {
  for (const [name, plan] of Object.entries(plans))
    for (const kind of ['fn', 'keys'] as const)
      for (const read of ['probe', 'pull'] as const)
        for (const skip of [false, true])
          it(`is off once its weight ${name}, as off lanes: ${kind}, ${read}${skip ? ', unread at 0' : ''}`, () => {
            expect(run(true, kind, plan, read, skip)).toEqual(run(false, kind, plan, read, skip));
          });
});

describe('a rest-less channel sought back', () => {
  // Between off and on, 0.5 shows after 1 and not after 0; with a store, memory lets go of the 1
  // as later switches push it out.
  const plan = [1, 0.5, 0, 0.5, 1, 0, 1, 0];
  const run = async (lanes: boolean, role: boolean, read: 'probe' | 'ahead' | 'store') => {
    const store = read === 'store' ? memoryStore() : undefined;
    const m = mix<Part, Pose>(kit<Pose>({ x: sum(), tint: color(last()) }), {
      lanes,
      band: { on: 0.6, off: 0.4 },
      history: store === undefined ? { ms: 5000, tape } : { ms: 20, tape, store },
      keyOf: (p: Part) => p.id,
      ...(role ? { roles: ['r'] } : {}),
    });
    let w = 1;
    m.sync(0);
    m.cue({ patch: patches.fn(), weight: () => w, ...(role ? { role: 'r' } : {}) });
    const a = parts[0] as Part;
    const seen = plan.map((weight, i) => {
      w = weight;
      m.sync(16 * (i + 1));
      return JSON.stringify(m.probe(a).tint);
    });
    if (store !== undefined) {
      expect([...store.held.values()].some((p) => p.stream === 'band')).toBe(true);
      await m.prepare(32);
    }
    m.seek(read === 'ahead' ? 16 : 32);
    w = 0.5;
    const sought = JSON.stringify((read === 'ahead' ? m.project(32) : m).probe(a).tint);
    return { seen, sought };
  };
  for (const lanes of [true, false])
    for (const role of [false, true])
      for (const read of ['probe', 'ahead', 'store'] as const)
        it(`shows what its frame showed${role ? ', in a role' : ''}, ${read}, lanes ${lanes ? 'on' : 'off'}`, async () => {
          const { seen, sought } = await run(lanes, role, read);
          expect(seen[1]).toBe(seen[0]);
          expect(seen[3]).not.toBe(seen[0]);
          expect(sought).toBe(seen[1]);
        });

  for (const lanes of [true, false])
    it(`reads ahead in a role, with no history, as play shows it, lanes ${lanes ? 'on' : 'off'}`, () => {
      const m = mix<Part, Pose>(kit<Pose>({ x: sum(), tint: color(last()) }), {
        lanes,
        band: { on: 0.6, off: 0.4 },
        roles: ['r'],
      });
      let w = 1;
      m.sync(0);
      m.cue({ patch: patches.fn(), weight: () => w, role: 'r' });
      const a = parts[0] as Part;
      m.sync(16);
      const shown = JSON.stringify(m.probe(a).tint);
      w = 0.5;
      expect(JSON.stringify(m.project(32).probe(a).tint)).toBe(shown);
      m.sync(32);
      expect(JSON.stringify(m.probe(a).tint)).toBe(shown);
    });
});
