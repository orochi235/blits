import { createHistory as tape } from '@weasel-js/history';
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

  it('cuts a voice already fading, slowly or for rest, so the mix can go inert', () => {
    for (const fade of [{ over: 5000 }, { at: 'rest' as const }]) {
      const m = mix<object, Pose>(K);
      const a = {};
      const self = bind(m, a);
      const h = self.cue({ patch: push(2), loop: true });
      m.sync(0);
      m.probe(a);
      h.fade(fade);
      m.sync(10);
      self.drop();
      m.sync(20);
      expect(h.state).toBe('done');
      expect(m.live).toBe(false);
    }
  });

  it('cuts a voice a seek back brought back after it ended', async () => {
    const m = mix<object, Pose>(K, { history: { ms: 10_000, tape } });
    const a = {};
    const self = bind(m, a);
    const h = self.cue({ patch: patch<object, Pose>(100, () => ({ x: 2 }), { writes: ['x'] }) });
    for (let t = 0; t <= 500; t += 16) m.sync(t);
    await h.done;
    m.seek(50);
    expect(h.state).toBe('live');
    self.drop();
    m.sync(520);
    expect(h.state).toBe('done');
    expect(m.probe(a).x).toBe(0);
  });
});
