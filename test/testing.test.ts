import { describe, expect, it } from 'vitest';
import { kit, max, mul, sum } from '../src/channels.js';
import { spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { checkPatch, setting } from '../src/testing.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
  hue?: number;
}
const subject: Part = { id: 'a' };

const integrator = (more: Partial<Parameters<typeof patch<Part, Pose, { x: number }>>[2]> = {}) =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
    ...more,
  });

describe('setting', () => {
  it('keeps per owner and collects what is sent', () => {
    const s = setting<void>({ elapsed: 120 });
    const owner = {};
    expect(s.keep(owner, () => ({ n: 1 }))).toBe(s.keep(owner, () => ({ n: 2 })));
    s.send('hit');
    expect(s.sent).toEqual(['hit']);
    expect(s.elapsed).toBe(120);
    expect(s.weight).toBe(1);
  });
});

describe('checkPatch', () => {
  it('passes the stock forms and a well-made stateful patch', () => {
    const ramp = keys<Part, Pose>(300, [
      { at: 0, delta: { gain: 1 } },
      { at: 1, delta: { gain: 0.2 } },
    ]);
    expect(checkPatch(ramp, { subject, kit: K })).toEqual([]);
    expect(checkPatch(spring<Part, Pose>('x', { to: 10 }), { subject, kit: K })).toEqual([]);
    const packed = {
      ...integrator({ pack: (s) => s.x, unpack: (d) => ({ x: d as number }) }),
      clone: (s: { x: number }) => ({ ...s }),
    };
    expect(checkPatch(packed, { subject, kit: K })).toEqual([]);
  });

  it('names each problem', () => {
    let calls = 0;
    const made = patch<Part, Pose, { x: number }>(
      100,
      (p, s, st) => {
        s.hue = p;
        return { x: st.state.x + calls++, gain: 1 } as Partial<Pose>;
      },
      {
        writes: ['x'],
        reads: ['scroll'],
        state: () => ({ x: 0 }),
        step: (s) => {
          s.x += Math.random();
        },
        pack: (s) => s.x,
      },
    );
    const bad = { ...made, clone: (s: { x: number }) => s };
    expect(
      checkPatch(bad, { subject: { id: 'b' }, kit: kit<Pose>({ x: max(), gain: mul() }) }),
    ).toEqual([
      'reads host.scroll, which the host given lacks',
      'at() writes gain, which is not in writes',
      'at() gives a different delta for the same phase, subject and state',
      'at() or step() changed the subject',
      'step() lands somewhere else from the same start and steps',
      'clone() hands back the state itself, not a copy',
      'pack and unpack come as a pair',
    ]);
  });

  it('names a state shared between subjects', () => {
    const one = { x: 0 };
    expect(checkPatch(integrator({ state: () => one }), { subject })).toEqual([
      'state() hands every subject the same object, so they share state',
      'at() gives a different delta for the same phase, subject and state',
    ]);
  });

  it('says where a kit does not fit', () => {
    const p = patch<Part, Pose>(100, () => ({ x: 1 }), { writes: ['x'], kit: { x: sum() } });
    expect(checkPatch(p, { subject, kit: kit<Pose>({ x: max(), gain: mul() }) })).toEqual([
      'blits: channel x is max in this kit, but the patch was written for sum',
    ]);
  });
});
