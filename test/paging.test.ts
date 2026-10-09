import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { HistoryMiss } from '../src/paging.js';
import { keys, patch } from '../src/patch.js';
import { level, slew } from '../src/signals.js';
import { transport } from '../src/transport.js';
import type { Handle, Mix, MixOptions, Patch } from '../src/types.js';
import { memoryStore } from './store.js';

interface P {
  x: number;
}
const K = kit<P>({ x: sum() });
const ramp = (ms: number) => patch<string, P>(ms, (ph) => ({ x: ph * 100 }), { writes: ['x'] });

describe('history without a store', () => {
  it('refuses a seek back past what an earlier seek let go', () => {
    const m = mix<string, P>(K, { history: { ms: 500, tape } });
    for (let t = 0; t <= 2000; t += 100) {
      m.sync(t);
      if (t === 300) m.cue({ patch: ramp(1000), subjects: ['a'], loop: false });
    }
    m.seek(1600);
    // 1200 is within 500 of 1600, but the run let go of it at 1500, when it stood at 2000.
    expect(() => m.seek(1200)).toThrow(/older/);
    expect(() => m.project(1200)).toThrow(/older/);
    expect(m.now).toBe(1600);
  });
});

interface Pose {
  x: number;
  gain: number;
}
const KP = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
}
const a = { id: 'a' };
const b = { id: 'b' };
const probes = (m: Mix<Part, Pose>) => [a, b].map((s) => ({ ...m.probe(s) }));

const wave = patch<Part, Pose>(400, (phase) => ({ x: Math.sin(phase * 2 * Math.PI) * 10 }), {
  writes: ['x'],
});
const fall = keys<Part, Pose>(300, [
  { at: 0, delta: { gain: 1 } },
  { at: 1, delta: { gain: 0.2 } },
]);
// Integrates toward 50 by explicit Euler, so its value depends on how it is stepped.
const drift = () =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
    pack: (s) => ({ ...s }),
    unpack: (d) => ({ ...(d as { x: number }) }),
  });

const every = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
};

type Scene = (m: Mix<Part, Pose>, t: number, h: Record<string, Handle<Part>>) => void;

const busy: Scene = (m, t, h) => {
  if (t === 0) {
    h.wave = m.cue({ patch: wave, fade: { in: 100, out: 150 } });
    h.drift = m.cue({ patch: drift(), weight: slew(() => 1, { riseMs: 300 }) });
    h.fall = m.cue({ patch: fall, start: 200, loop: 2, fade: { out: 60 } });
  }
  if (t === 240) (h.wave as { rate: number }).rate = 2;
  if (t === 320) (h.drift as { weight: number }).weight = 0.5;
  if (t === 400) h.wave?.fade();
  if (t === 480) h.drift?.seek(100);
  if (t === 560) h.late = m.cue({ patch: wave, weight: 0.5 });
  if (t === 640) m.drop(b);
};

const paged = (store = memoryStore(), extra: Partial<MixOptions> = {}): MixOptions => ({
  history: { ms: 100, every: 50, tape, store },
  stepMs: 4,
  keyOf: (p: Part) => p.id,
  ...extra,
});

function play(scene: Scene, frames: number[], opts: MixOptions) {
  const m = mix<Part, Pose>(KP, opts);
  const h: Record<string, Handle<Part>> = {};
  const poses = new Map<number, Pose[]>();
  for (const t of frames) {
    m.sync(t);
    scene(m, t, h);
    poses.set(t, probes(m));
  }
  return { m, h, poses };
}

/** Seeks back to `t`, which the run shows, and plays on, each frame equal to what the run showed. */
function replays(run: ReturnType<typeof play>, frames: number[], t: number) {
  run.m.seek(t);
  expect(probes(run.m)).toEqual(run.poses.get(t));
  const last = frames[frames.length - 1] as number;
  for (const f of frames.filter((f) => f > t)) {
    run.m.sync(last + (f - t));
    expect(probes(run.m)).toEqual(run.poses.get(f));
  }
}

describe('history with a store', () => {
  for (const lanes of [true, false])
    it(`seeks back past memory exactly once prepared${lanes ? '' : ', without lanes'}`, async () => {
      const frames = every(0, 1200, 16);
      for (const t of [208, 400, 496, 592, 656]) {
        const store = memoryStore();
        const run = play(busy, frames, paged(store, { lanes }));
        expect(store.held.size).toBeGreaterThan(0);
        await run.m.prepare(t);
        replays(run, frames, t);
      }
    });

  it('pages its rate changes, marks and frames, and brings them back for a seek past memory', async () => {
    // Rate 0 holds mix time at 256 from 256 to 336, where a cue waits on a mark announced then.
    const scene: Scene = (m, t, h) => {
      if (t === 0) busy(m, t, h);
      if (t === 128) m.rate = 2;
      if (t === 192) m.rate = 1;
      if (t === 256) m.rate = 0;
      if (t === 288) {
        m.announce('beat', { at: 300 });
        h.on = m.cue({ patch: fall, name: 'on', anchor: { start: { of: 'beat' } } });
      }
      if (t === 336) m.rate = 1;
    };
    const frames = every(0, 1600, 16);
    const store = memoryStore();
    const run = play(scene, frames, paged(store));
    const streams = new Set([...store.held.values()].map((p) => p.stream));
    expect(
      [...streams].filter((s) => s === 'pace' || s === 'mark' || s === 'frame').sort(),
    ).toEqual(['frame', 'mark', 'pace']);
    const t = run.m as unknown as { transport: { frames: unknown[]; announced: unknown[] } };
    expect(t.transport.frames.length).toBeLessThan(16);
    expect(t.transport.announced).toEqual([]);
    for (const f of [192, 288, 320, 352]) {
      const again = play(scene, frames, paged());
      const mixT = new Map<number, number>();
      const probe = mix<Part, Pose>(KP, paged());
      const hs: Record<string, Handle<Part>> = {};
      for (const g of frames) {
        probe.sync(g);
        scene(probe, g, hs);
        mixT.set(g, probe.now);
      }
      const at = mixT.get(f) as number;
      // Rate 0 held mix time from 256 to 336: a seek there lands on the last of those frames.
      const landing = Math.max(...frames.filter((g) => mixT.get(g) === at));
      await again.m.prepare(at);
      again.m.seek(at);
      expect(probes(again.m)).toEqual(again.poses.get(landing));
      for (const g of frames.filter((g) => g > landing)) {
        again.m.sync(1600 + (g - landing));
        expect(probes(again.m)).toEqual(again.poses.get(g));
      }
    }
  });

  it('throws HistoryMiss before anything moves when nothing was prepared', () => {
    const frames = every(0, 1200, 16);
    const run = play(busy, frames, paged());
    const before = probes(run.m);
    let miss: unknown;
    try {
      run.m.seek(208);
    } catch (e) {
      miss = e;
    }
    expect(miss).toBeInstanceOf(HistoryMiss);
    expect((miss as HistoryMiss).at).toBe(208);
    expect((miss as HistoryMiss).mix).toBe('');
    expect(run.m.now).toBe(1200);
    expect(probes(run.m)).toEqual(before);
    expect(() => run.m.project(208)).toThrow(HistoryMiss);
  });

  it('reads back past memory once prepared', async () => {
    const frames = every(0, 1200, 16);
    const run = play(busy, frames, paged());
    await run.m.prepare(400);
    const p = run.m.project(496);
    expect([a, b].map((s) => ({ ...p.probe(s) }))).toEqual(run.poses.get(496));
    expect(run.m.now).toBe(1200);
  });

  it('loads nothing for a time memory still holds', async () => {
    const store = memoryStore();
    const run = play(busy, every(0, 1200, 16), paged(store));
    await run.m.prepare(1150);
    expect(store.loads).toBe(0);
    run.m.seek(1150);
  });

  it('forgets the future a seek back leaves, so a later seek reads the one played since', async () => {
    const frames = every(0, 1200, 16);
    const run = play(busy, frames, paged());
    await run.m.prepare(400);
    run.m.seek(400);
    // A different future from 528, where the tape's calls before it play again: no drop, and a
    // voice of its own.
    const other = mix<Part, Pose>(KP, paged());
    const h: Record<string, Handle<Part>> = {};
    const again = new Map<number, Pose[]>();
    for (const t of frames) {
      other.sync(t);
      if (t < 528) busy(other, t, h);
      if (t === 528) other.cue({ patch: fall, weight: 0.3 });
      again.set(t, probes(other));
    }
    for (const f of frames.filter((f) => f > 400)) {
      run.m.sync(1200 + (f - 400));
      if (f === 528) run.m.cue({ patch: fall, weight: 0.3 });
      expect(probes(run.m)).toEqual(again.get(f));
    }
    await run.m.prepare(704);
    run.m.seek(704);
    expect(probes(run.m)).toEqual(again.get(704));
  });

  it('needs keyOf for a subject that is not a string or number', () => {
    const m = mix<Part, Pose>(KP, { history: { ms: 100, tape, store: memoryStore() } });
    m.sync(0);
    m.cue({ patch: wave });
    expect(() => m.probe(a)).toThrow(/keyOf/);
    const ids = mix<string, Pose>(KP, { history: { ms: 100, tape, store: memoryStore() } });
    ids.sync(0);
    ids.cue({ patch: wave as unknown as Patch<string, Pose, unknown> });
    ids.probe('a');
  });

  it('refuses at cue a stateful patch with no pack and unpack', () => {
    const m = mix<Part, Pose>(KP, paged());
    const bare = patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
      writes: ['x'],
      state: () => ({ x: 0 }),
      step: () => {},
    });
    expect(() => m.cue({ patch: bare })).toThrow(/pack/);
    const plain = mix<Part, Pose>(KP, { history: { ms: 100, tape } });
    plain.cue({ patch: bare });
  });

  it('names every mix on a transport with a store, once', () => {
    const t = transport({ history: { ms: 100, tape, store: memoryStore() } });
    expect(() => mix(K, { transport: t })).toThrow(/name/);
    mix(K, { transport: t, name: 'one' });
    expect(() => mix(K, { transport: t, name: 'one' })).toThrow(/one/);
  });

  it('pages a motion patch’s stretches and released runs, and plays them back exactly', async () => {
    const frames = every(0, 1200, 16);
    for (const t of [80, 208, 400, 656]) {
      const s = spring<Part, Pose>('x', { from: 0, to: 100 });
      const scene: Scene = (m, at) => {
        if (at === 0) m.cue({ patch: s });
        if (at === 96) s.to(a, 20, 500);
        if (at === 304) s.to(a, -40);
        if (at === 400) s.push(b, 300);
        if (at === 496) s.to(a, 70);
        if (at === 640) m.drop(b);
        if (at === 800) s.to(b, 10);
        if (at === 1008) m.drop(b);
      };
      const store = memoryStore();
      const run = play(scene, frames, paged(store));
      const streams = new Set([...store.held.values()].map((p) => p.stream));
      expect(streams).toContain('stretch');
      expect(streams).toContain('released');
      await run.m.prepare(t);
      replays(run, frames, t);
    }
  });

  it('reads input signals and host fields back past memory as they were', async () => {
    const host = { pointer: { x: 0 } };
    const follow = patch<Part, Pose>(
      0,
      (_p, _s, st) => ({ gain: 1 + (st.host as typeof host).pointer.x }),
      { writes: ['gain'], reads: ['pointer'] },
    );
    const knob = level<Part>(0.2);
    const m = mix<Part, Pose>(KP, {
      ...paged(),
      host,
      history: { ms: 100, inputs: true, tape, store: memoryStore() },
    });
    m.cue({ patch: wave, weight: slew(knob, { riseMs: 100, fallMs: 100 }) });
    m.cue({ patch: follow });
    const seen = new Map<number, Pose>();
    for (const t of every(0, 1000, 20)) {
      host.pointer.x = t < 300 ? t / 100 : 3;
      m.sync(t);
      if (t === 200) knob.set(0.9);
      if (t === 600) knob.set(0.4);
      seen.set(t, { ...m.probe(a) });
    }
    await m.prepare(100);
    for (const t of [100, 220, 260, 640]) {
      const p = m.project(t);
      expect({ ...p.probe(a) }).toEqual(seen.get(t));
      expect(p.assess(a)).toEqual({ x: 'exact', gain: 'exact' });
    }
  });
});
