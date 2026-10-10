import { describe, expect, it } from 'vitest';
import { kit, last, sum } from '../src/channels.js';
import { VoiceHandle } from '../src/handle.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import type { Handle, MixOptions, VoiceSpec } from '../src/types.js';
import type { Voice } from '../src/voice.js';

interface Part {
  id: number;
}
interface Pose {
  x: number;
  tag?: number;
}
const K = kit<Pose>({ x: sum(), tag: last() });
const ramp = () =>
  keys<Part, Pose>(1000, [
    { at: 0, delta: { x: 0 } },
    { at: 1, delta: { x: 10 } },
  ]);
const voiceOf = (h: Handle<Part>) =>
  VoiceHandle.voiceOf(h as unknown as VoiceHandle<Part, Pose>) as Voice<Part, Pose>;

/** A mix with one voice cued from `spec`, synced to 100 with every part probed. */
function played(spec: Partial<VoiceSpec<Part, Pose>> = {}, opts: MixOptions = {}) {
  const m = mix<Part, Pose>(K, { lanes: true, ...opts });
  const parts = Array.from({ length: 40 }, (_, id) => ({ id }));
  const h = m.cue({ patch: ramp(), ...spec });
  m.sync(0);
  m.sync(100);
  for (const p of parts) m.probe(p);
  return { m, parts, h, voice: voiceOf(h) };
}

describe('a voice over every subject', () => {
  it('keeps one record for them all, and counts each subject it was asked about once', () => {
    const { m, parts, voice } = played();
    expect(voice.sharing).toBe(true);
    expect(voice.everyone).not.toBeNull();
    for (const p of parts) expect(voice.subjects.get(p)).toBeUndefined();
    expect(voice.seen).toBe(parts.length);
    m.sync(200);
    for (const p of parts) expect(m.probe(p).x).toBeCloseTo(2);
    expect(voice.seen).toBe(parts.length);
  });

  it('keeps a record a subject where a subject can differ', () => {
    const own = (spec: Partial<VoiceSpec<Part, Pose>>, opts?: MixOptions) => {
      const { parts, voice } = played(spec, opts);
      expect(voice.sharing).toBe(false);
      expect(voice.everyone).toBeNull();
      expect(voice.subjects.get(parts[3] as Part)).toBeDefined();
    };
    own({ stagger: (p) => p.id });
    own({ target: (p) => p.id % 2 === 0 || p.id === 3 });
    own({ freeze: 'both' });
    own({ from: 'current' });
    own({ locus: 'a' });
    own({ weight: (p) => (p.id === 3 ? 1 : 0.5) });
    own({}, { lanes: false });
    own({}, { history: { ms: 1000 } });
    own({
      patch: patch<Part, Pose>(1000, () => ({ tag: 1 }), { writes: ['tag'] }),
    });
    own({
      patch: patch<Part, Pose, { n: number }>(1000, (_phase, _part, s) => ({ x: s.state.n }), {
        writes: ['x'],
        state: () => ({ n: 1 }),
      }),
    });
  });

  it('goes back to a record a subject when one subject fades out of it, with the weight it gave each', () => {
    const { m, parts, h, voice } = played({ weight: 0.5 });
    const before = parts.map((p) => h.weightOf(p));
    expect(before.every((w) => w === 0.5)).toBe(true);
    h.fade({ subject: parts[0] as Part, over: 0 });
    expect(voice.sharing).toBe(false);
    expect(voice.everyone).toBeNull();
    expect(parts.map((p) => h.weightOf(p)).slice(1)).toEqual(before.slice(1));
    m.sync(200);
    for (const p of parts) m.probe(p);
    expect(voice.subjects.get(parts[1] as Part)).toBeDefined();
    expect(voice.seen).toBe(parts.length - 1);
    expect(m.probe(parts[0] as Part).x).toBe(0);
    expect(m.probe(parts[1] as Part).x).toBeCloseTo(1);
  });

  it('goes back when it fades at rest, and waits for every subject it was asked about', () => {
    const { m, parts, h, voice } = played();
    h.fade({ at: 'rest', deadline: 5000 });
    expect(voice.sharing).toBe(false);
    expect(voice.seen).toBe(parts.length);
    m.sync(200);
    m.probe(parts[0] as Part);
    expect(voice.seen).toBe(parts.length);
    expect(voice.state).toBe('fading');
  });

  it('forgets a dropped subject, and counts it again when it comes back', () => {
    const { m, parts, voice } = played();
    m.drop(parts[0] as Part);
    m.sync(200);
    expect(m.probe(parts[0] as Part).x).toBeCloseTo(2);
    expect(voice.seen).toBe(parts.length + 1);
  });

  it('gives a patch that starts keeping state the record it was called on', () => {
    const owner = {};
    const m = mix<Part, Pose>(K, { lanes: true });
    const parts = Array.from({ length: 4 }, (_, id) => ({ id }));
    const h = m.cue({
      patch: patch<Part, Pose>(
        1000,
        (phase, _part, setting) => {
          if (phase < 0.5) return { x: 0 };
          const kept = setting.keep(owner, () => ({ n: 0 }));
          kept.n++;
          return { x: kept.n };
        },
        { writes: ['x'] },
      ),
    });
    const voice = voiceOf(h);
    m.sync(0);
    m.sync(100);
    for (const p of parts) m.probe(p);
    expect(voice.sharing).toBe(true);
    for (const t of [600, 700, 800]) {
      m.sync(t);
      expect(parts.map((p) => m.probe(p).x)).toEqual(parts.map(() => (t - 500) / 100));
    }
    expect(voice.sharing).toBe(false);
    for (const p of parts) expect(voice.subjects.get(p)?.kept?.get(owner)).toEqual({ n: 3 });
  });

  it('calls its patch once a frame for a subject, however its probes fall among other subjects', () => {
    for (const lanes of [true, false]) {
      const calls = new Map<number, number>();
      const m = mix<Part, Pose>(K, { lanes });
      const parts = Array.from({ length: 5 }, (_, id) => ({ id }));
      const h = m.cue({
        patch: patch<Part, Pose>(
          1000,
          (_phase, p) => {
            calls.set(p.id, (calls.get(p.id) ?? 0) + 1);
            return { x: p.id };
          },
          { writes: ['x'] },
        ),
      });
      expect(voiceOf(h).sharing).toBe(lanes);
      for (const t of [0, 16, 32, 48]) {
        calls.clear();
        m.sync(t);
        for (const p of parts) m.probe(p);
        for (const p of [...parts].reverse()) expect(m.probe(p).x).toBe(p.id);
        m.atRest(parts[2] as Part);
        expect([...calls.values()], `lanes ${lanes} t=${t}`).toEqual(parts.map(() => 1));
      }
    }
  });

  it('is read ahead from a copy of its one record, and stays as it was', () => {
    const { m, parts, voice } = played();
    const ahead = m.project(300);
    expect(parts.map((p) => ahead.probe(p).x)).toEqual(parts.map(() => 3));
    expect(ahead.assess(parts[0] as Part).x).toBe('exact');
    // A subject the live mix has never probed reads as the voice gives every subject.
    expect(ahead.probe({ id: 99 }).x).toBe(3);
    expect(voice.sharing).toBe(true);
    for (const p of parts) expect(voice.subjects.get(p)).toBeUndefined();
    m.sync(300);
    expect(parts.map((p) => m.probe(p).x)).toEqual(parts.map(() => 3));
  });

  it('reads a subject again after touch(subject)', () => {
    let k = 1;
    const m = mix<Part, Pose>(K, { lanes: true });
    const [a, b] = [{ id: 0 }, { id: 1 }];
    m.cue({ patch: patch<Part, Pose>(1000, () => ({ x: k }), { writes: ['x'] }) });
    m.sync(0);
    m.sync(100);
    expect([m.probe(a).x, m.probe(b).x]).toEqual([1, 1]);
    k = 2;
    m.touch(a);
    expect(m.probe(a).x).toBe(2);
  });
});
