import { describe, expect, it } from 'vitest';
import { bind } from '../src/bind.js';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { VoiceSpec } from '../src/types.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const push = (x: number) => patch<object, Pose>(1000, () => ({ x }), { writes: ['x'] });

describe('bind', () => {
  it('cues on its subject alone', () => {
    const m = mix<object, Pose>(K);
    const a = {};
    const b = {};
    bind(m, a).cue({ patch: push(2) });
    m.sync(0);
    expect(m.probe(a).x).toBe(2);
    expect(m.probe(b).x).toBe(0);
  });

  it('refuses a spec naming subjects, and a cue after drop', () => {
    const m = mix<object, Pose>(K);
    const a = {};
    const self = bind(m, a);
    const named = { patch: push(1), subjects: [a] } as unknown as Omit<
      VoiceSpec<object, Pose>,
      'subjects'
    >;
    expect(() => self.cue(named)).toThrow(/names its own subject/);
    self.drop();
    expect(() => self.cue({ patch: push(1) })).toThrow(/dropped/);
  });

  it('cuts what it cued on drop, and leaves voices cued otherwise', () => {
    const m = mix<object, Pose>(K);
    const a = {};
    const self = bind(m, a);
    const own = self.cue({ patch: push(2) });
    const other = m.cue({ patch: push(5), subjects: [a] });
    m.sync(0);
    expect(m.probe(a).x).toBe(7);
    self.drop();
    self.drop();
    m.sync(16);
    expect(m.probe(a).x).toBe(5);
    expect(own.state).toBe('done');
    expect(other.state).not.toBe('done');
  });
});
