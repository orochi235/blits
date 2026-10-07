import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { HistoryMiss } from '../src/paging.js';
import { patch } from '../src/patch.js';
import { peak, slew } from '../src/signals.js';
import { transport } from '../src/transport.js';
import type { Described, Handle, Mix, MixOptions, Paged, VoiceSpec } from '../src/types.js';
import { memoryStore } from './store.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
}
const a = { id: 'a' };
const b = { id: 'b' };
const probes = (m: Mix<Part, Pose>) => [a, b].map((s) => ({ ...m.probe(s) }));
const every = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to; t += step) out.push(t);
  return out;
};

const wave = patch<Part, Pose>(400, (phase) => ({ x: Math.sin(phase * 2 * Math.PI) * 10 }), {
  writes: ['x'],
});

/** What astv does: every voice is built from plain data, so the store can rebuild it. */
function build(d: Described): VoiceSpec<Part, Pose> {
  const data = d.data as { w: number };
  switch (d.kind) {
    case 'wave':
      return { patch: wave, weight: data.w, loop: false, fade: { in: 50, out: 50 } };
    case 'spring':
      return { patch: spring<Part, Pose>('x', { from: 0, to: 100 }) };
    default:
      return {
        patch: patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
          writes: ['x'],
          state: () => ({ x: 0 }),
          step: (s, dt) => {
            s.x += (50 - s.x) * Math.min(1, dt / 200);
          },
          pack: (s) => ({ ...s }),
          unpack: (p) => ({ ...(p as { x: number }) }),
        }),
        // State kept by two signals inside a third, which no path into the spec reaches.
        weight: peak(
          slew(() => 1, { riseMs: 300 }),
          slew(() => 0.5, { riseMs: 100 }),
        ),
      };
  }
}

const cue = (m: Mix<Part, Pose>, d: Described) => {
  const spec = build(d);
  return { spec, h: m.cue({ ...spec, as: d }) };
};

const opts = (store = memoryStore()): MixOptions => ({
  history: { ms: 100, every: 50, tape, store, revive: build },
  stepMs: 4,
  keyOf: (p: Part) => p.id,
});

type Scene = (m: Mix<Part, Pose>, t: number, h: Record<string, Handle<Part>>) => void;

const roster: Scene = (m, t, h) => {
  if (t === 0) {
    h.wave = cue(m, { kind: 'wave', data: { w: 0.5 } }).h;
    const s = cue(m, { kind: 'spring', data: {} });
    h.spring = s.h;
    (h as Record<string, unknown>).patch = s.spec.patch;
  }
  if (t === 48) h.drift = cue(m, { kind: 'drift', data: {} }).h;
  if (t === 96) (h as unknown as { patch: { to(s: Part, x: number): void } }).patch.to(a, 20);
  if (t === 304) h.spring?.fade({ over: 100 });
  if (t === 400) h.drift?.fade({ over: 100 });
  if (t === 560) h.late = cue(m, { kind: 'wave', data: { w: 0.3 } }).h;
  if (t === 608) (h.late as { weight: number }).weight = 0.8;
};

function play(scene: Scene, frames: number[], o: MixOptions) {
  const m = mix<Part, Pose>(K, o);
  const h: Record<string, Handle<Part>> = {};
  const poses = new Map<number, Pose[]>();
  for (const t of frames) {
    m.sync(t);
    scene(m, t, h);
    poses.set(t, probes(m));
  }
  return { m, h, poses };
}

const gone = (m: Mix<Part, Pose>) => (m as unknown as { gone: unknown[] }).gone.length;

describe('voices paged out with a descriptor', () => {
  it('leave memory once they have left, and come back exactly on a seek', async () => {
    const frames = every(0, 1200, 16);
    for (const t of [32, 208, 320, 464, 640]) {
      const store = memoryStore();
      const run = play(roster, frames, opts(store));
      expect(gone(run.m)).toBe(0);
      expect([...store.held.values()].filter((p) => p.stream === 'voice')).toHaveLength(4);
      expect(run.h.wave?.state).toBe('done');
      await run.m.prepare(t);
      run.m.seek(t);
      expect(probes(run.m)).toEqual(run.poses.get(t));
      for (const f of frames.filter((f) => f > t)) {
        run.m.sync(1200 + (f - t));
        expect(probes(run.m)).toEqual(run.poses.get(f));
      }
    }
  });

  it('come back behind the handles the host holds', async () => {
    const run = play(roster, every(0, 1200, 16), opts());
    const late = run.h.late as Handle<Part>;
    expect(run.h.drift?.state).toBe('done');
    expect(await run.h.drift?.played).toBe(false);
    await run.m.prepare(464);
    run.m.seek(464);
    expect(run.h.drift?.state).toBe('fading');
    expect(late.state).toBe('pending');
    run.m.sync(1200 + 200);
    expect(late.state).toBe('live');
    expect(late.weight).toBe(0.8);
    expect(run.m.voices()).toContain(late);
  });

  it('stay in memory without a descriptor', () => {
    const m = mix<Part, Pose>(K, opts());
    for (const t of every(0, 1200, 16)) {
      m.sync(t);
      if (t === 0) m.cue({ patch: wave, loop: false });
    }
    expect(gone(m)).toBe(1);
  });

  it('throw HistoryMiss where the store does not give one back', async () => {
    const store = memoryStore();
    const run = play(roster, every(0, 1200, 16), opts(store));
    const load = store.load;
    store.load = async (t) => (await load(t)).filter((p: Paged) => p.stream !== 'voice');
    await run.m.prepare(208);
    expect(() => run.m.seek(208)).toThrow(HistoryMiss);
    expect(run.m.now).toBe(1200);
  });

  it('refuse a descriptor at cue without history.revive', () => {
    const m = mix<Part, Pose>(K, { ...opts(), history: { ms: 100, tape, store: memoryStore() } });
    expect(() => m.cue({ patch: wave, as: { kind: 'wave', data: {} } })).toThrow(/revive/);
  });

  it('page and come back across the mixes of a transport', async () => {
    const t = transport({
      history: { ms: 100, every: 50, tape, store: memoryStore(), revive: build },
    });
    const one = mix<Part, Pose>(K, { transport: t, name: 'one', keyOf: (p: Part) => p.id });
    const two = mix<Part, Pose>(K, { transport: t, name: 'two', keyOf: (p: Part) => p.id });
    const seen = new Map<number, Pose[]>();
    for (const at of every(0, 1000, 20)) {
      t.sync(at);
      if (at === 0) cue(one, { kind: 'wave', data: { w: 1 } });
      if (at === 100) cue(two, { kind: 'drift', data: {} }).h.fade({ over: 200 });
      seen.set(at, [...probes(one), ...probes(two)]);
    }
    await t.prepare(240);
    t.seek(240);
    expect([...probes(one), ...probes(two)]).toEqual(seen.get(240));
  });
});
