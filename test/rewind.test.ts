import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { slew } from '../src/signals.js';
import type { BookedHit, Handle, Mix, MixOptions } from '../src/types.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
}

const wave = patch<Part, Pose>(400, (phase) => ({ x: Math.sin(phase * 2 * Math.PI) * 10 }), {
  writes: ['x'],
});
const ramp = keys<Part, Pose>(300, [
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
  });

const every = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
};

type Scene = (m: Mix<Part, Pose>, t: number, h: Record<string, Handle<Part>>) => void;

/** Plays a scene frame by frame, the host making its calls at frame `t` only up to `until`. */
function play(
  scene: Scene,
  frames: number[],
  subjects: Part[],
  opts: MixOptions,
  until = Infinity,
) {
  const m = mix<Part, Pose>(K, opts);
  const h: Record<string, Handle<Part>> = {};
  const poses = new Map<number, Pose[]>();
  for (const t of frames) {
    m.sync(t);
    if (t <= until) scene(m, t, h);
    poses.set(
      t,
      subjects.map((s) => ({ ...m.probe(s) })),
    );
  }
  return { m, h, poses };
}

const a = { id: 'a' };
const b = { id: 'b' };

const busy: Scene = (m, t, h) => {
  if (t === 0) {
    h.wave = m.cue({ patch: wave, fade: { in: 100, out: 150 } });
    h.drift = m.cue({ patch: drift(), weight: slew(() => 1, { riseMs: 300 }) });
    h.ramp = m.cue({ patch: ramp, start: 200, loop: 2, fade: { out: 60 } });
  }
  if (t === 240) (h.wave as { rate: number }).rate = 2;
  if (t === 320) (h.drift as { weight: number }).weight = 0.5;
  if (t === 400) h.wave?.fade();
  if (t === 480) h.drift?.seek(100);
  if (t === 560) h.late = m.cue({ patch: wave, weight: 0.5 });
  if (t === 640) m.rate = 0.5;
};

describe('rewind', () => {
  for (const lanes of [true, false])
    it(`plays on from the moment it went back to as if nothing after it happened${lanes ? '' : ', without lanes'}`, () => {
      const opts: MixOptions = { history: { ms: 5000, every: 50 }, stepMs: 4, lanes };
      const frames = every(0, 1200, 16);
      for (const t of [208, 400, 496, 592]) {
        const live = play(busy, frames, [a, b], opts);
        const ref = play(busy, frames, [a, b], opts, t);
        live.m.rewind(t);
        expect([a, b].map((s) => ({ ...live.m.probe(s) }))).toEqual(ref.poses.get(t));
        for (const f of frames.filter((f) => f > t)) {
          live.m.sync(1200 + (f - t));
          expect([a, b].map((s) => ({ ...live.m.probe(s) }))).toEqual(ref.poses.get(f));
        }
      }
    });

  it('needs history, reaches only as far as it keeps, and only goes back', () => {
    const plain = mix<Part, Pose>(K);
    plain.sync(0);
    expect(() => plain.rewind(0)).toThrow(/history/);
    const m = mix<Part, Pose>(K, { history: { ms: 500 } });
    expect(() => m.rewind(0)).toThrow(/never synced/);
    m.cue({ patch: wave });
    for (const t of every(0, 1000, 100)) m.sync(t);
    expect(() => m.rewind(400)).toThrow(/older/);
    expect(() => m.rewind(1100)).toThrow(RangeError);
    m.rewind(700);
    expect(m.probe(a).x).toBeCloseTo(-10, 9);
  });

  it('keeps the handles the host holds: a voice that left comes back on its own', async () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    m.sync(0);
    const h = m.cue({ patch: wave, loop: false });
    const first = h.played;
    for (const t of every(0, 600, 20)) m.sync(t);
    expect(h.state).toBe('done');
    expect(await first).toBe(true);
    m.rewind(200);
    expect(h.state).toBe('live');
    expect(m.voices()).toEqual([h]);
    // Settled after the moment it went back to, so it starts over.
    expect(h.played).not.toBe(first);
    let played: boolean | undefined;
    void h.played.then((p) => {
      played = p;
    });
    await Promise.resolve();
    expect(played).toBeUndefined();
    for (const t of every(620, 900, 20)) m.sync(t);
    await Promise.resolve();
    expect(played).toBe(true);
    expect(h.state).toBe('done');
  });

  it('takes out a voice cued after the moment: done resolves and played is false', async () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    m.sync(0);
    m.cue({ patch: wave });
    m.sync(100);
    const later = m.cue({ patch: ramp });
    m.sync(200);
    m.rewind(50);
    expect(later.state).toBe('done');
    expect(await later.played).toBe(false);
    await later.done;
    expect(m.voices()).toHaveLength(1);
    expect(m.probe(a).gain).toBe(1);
  });

  it('cuts a spring retarget made after the moment, and keeps one made before it for after', () => {
    const run = (
      calls: (s: ReturnType<typeof spring<Part, Pose>>, t: number) => void,
      to = 800,
    ) => {
      const s = spring<Part, Pose>('x', { from: 0, to: 100 });
      const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
      m.cue({ patch: s });
      const seen = new Map<number, number>();
      for (const t of every(0, to, 16)) {
        m.sync(t);
        calls(s, t);
        seen.set(t, m.probe(a).x);
      }
      return { m, seen };
    };
    const calls = (s: ReturnType<typeof spring<Part, Pose>>, t: number) => {
      if (t === 96) s.to(a, 20, 500);
      if (t === 304) s.to(a, -40);
    };
    const live = run(calls);
    const ref = run((s, t) => t <= 208 && calls(s, t));
    live.m.rewind(208);
    for (const f of every(224, 800, 16)) {
      live.m.sync(800 + (f - 208));
      expect(live.m.probe(a).x).toBeCloseTo(ref.seen.get(f) as number, 9);
    }
  });

  it('drops undrained events from after the moment, and sends them again as it plays past it', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000 }, stepMs: 10 });
    const beat = patch<Part, Pose, { n: number }>(0, () => ({}), {
      writes: [],
      state: () => ({ n: 0 }),
      step: (s, _dt, _subject, setting) => {
        s.n++;
        if (s.n % 10 === 0) setting.send(s.n);
      },
    });
    m.cue({ patch: beat });
    for (const t of every(0, 300, 20)) {
      m.sync(t);
      m.probe(a);
    }
    const before = m.drain().map((e) => e.timestamp);
    expect(before).toEqual([100, 200, 300]);
    for (const t of every(320, 400, 20)) {
      m.sync(t);
      m.probe(a);
    }
    m.rewind(300);
    expect(m.drain()).toEqual([]);
    for (const t of every(420, 520, 20)) {
      m.sync(t);
      m.probe(a);
    }
    expect(m.drain().map((e) => e.event)).toEqual([40]);
  });

  it('brings back a subject faded out of a voice after the moment, as never seen', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000 }, stepMs: 5 });
    m.sync(0);
    const h = m.cue({ patch: drift() });
    for (const t of every(0, 200, 20)) {
      m.sync(t);
      m.probe(a);
    }
    m.sync(220);
    h.fade({ subject: a, over: 0 });
    m.sync(240);
    expect(m.probe(a).x).toBe(0);
    expect(h.weightOf(a)).toBe(0);
    m.rewind(180);
    m.sync(245);
    // Its record was forgotten, so it starts afresh from its voice's start, on the same grid.
    const fresh = mix<Part, Pose>(K, { stepMs: 5 });
    fresh.sync(0);
    fresh.cue({ patch: drift() });
    fresh.sync(185);
    expect(m.probe(a).x).toBeCloseTo(fresh.probe(a).x, 9);
    expect(h.weightOf(a)).toBe(1);
  });

  it('puts the mix rate and announced marks back as they stood', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    m.cue({ patch: wave });
    m.sync(0);
    m.sync(100);
    m.announce('cue');
    m.sync(200);
    m.rate = 0.5;
    m.announce('late');
    m.sync(300);
    m.rewind(100);
    expect(m.rate).toBe(1);
    expect(
      m
        .marks(0, 1000)
        .filter((k) => k.voice === undefined)
        .map((k) => k.name),
    ).toEqual(['cue']);
    // 150 ms of the host's clock later at rate 1: mix time 250, where at 0.5 it would be 225.
    m.sync(450);
    expect(m.probe(a).x).toBeCloseTo(Math.sin((250 / 400) * 2 * Math.PI) * 10, 9);
  });

  it('books hits after the moment again as the mix reaches them again', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    let host = 0;
    const took: { hit: BookedHit; stopped: boolean }[] = [];
    m.book({
      clock: () => host,
      ahead: 50,
      late: 40,
      take(item) {
        const t = { hit: item as BookedHit, stopped: false };
        if ('hit' in item) took.push(t);
        return {
          stop: () => {
            t.stopped = true;
          },
        };
      },
    });
    const sync = (t: number) => {
      host = t;
      m.sync(t);
    };
    m.cue({
      patch: wave,
      loop: false,
      hits: [
        { at: 100, event: 'a' },
        { at: 300, event: 'b' },
      ],
    });
    for (const t of every(0, 200, 20)) sync(t);
    expect(took.map((t) => t.hit.event)).toEqual(['a']);
    m.rewind(80);
    for (const t of every(220, 520, 20)) sync(t);
    expect(took.map((t) => [t.hit.event, t.hit.timestamp])).toEqual([
      ['a', 100],
      ['a', 220],
      ['b', 420],
    ]);
  });
});

describe('rewind, again and through owners', () => {
  it('goes back twice before a subject is read again, and plays on exactly', () => {
    const opts: MixOptions = { history: { ms: 5000, every: 50 }, stepMs: 4 };
    const frames = every(0, 1200, 16);
    const live = play(busy, frames, [a, b], opts);
    const ref = play(busy, frames, [a, b], opts, 304);
    live.m.rewind(800);
    live.m.rewind(304);
    for (const f of frames.filter((f) => f > 304)) {
      live.m.sync(1200 + (f - 304));
      expect([a, b].map((s) => ({ ...live.m.probe(s) }))).toEqual(ref.poses.get(f));
    }
  });

  it('pulls what it probes after going back', () => {
    const opts: MixOptions = { history: { ms: 5000, every: 50 }, stepMs: 4 };
    const live = play(busy, every(0, 800, 16), [a, b], opts);
    const x = new Float64Array(2);
    const gain = new Float64Array(2);
    live.m.pull([a, b], { x, gain });
    live.m.rewind(400);
    live.m.sync(816);
    live.m.pull([a, b], { x, gain });
    expect([x[0], x[1]]).toEqual([live.m.probe(a).x, live.m.probe(b).x]);
    expect([gain[0], gain[1]]).toEqual([live.m.probe(a).gain, live.m.probe(b).gain]);
  });

  it('brings an owner back with its children, and has it play once they all have again', async () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    m.sync(0);
    const o = m.owns({});
    const one = m.cue({ patch: wave, loop: false, owner: o });
    const two = m.cue({ patch: ramp, loop: false, owner: o });
    for (const t of every(20, 600, 20)) m.sync(t);
    expect([o.state, one.state, two.state]).toEqual(['done', 'done', 'done']);
    expect(await o.played).toBe(true);
    m.rewind(350);
    expect([o.state, one.state, two.state]).toEqual(['live', 'live', 'done']);
    let played: boolean | undefined;
    void o.played.then((p) => {
      played = p;
    });
    for (const t of every(620, 700, 20)) m.sync(t);
    await Promise.resolve();
    expect(played).toBe(true);
    expect([o.state, one.state]).toEqual(['done', 'done']);
  });

  it('maps a timestamp from before it went back by the offset in force then', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    m.cue({ patch: wave });
    for (const t of every(0, 300, 20)) m.sync(t);
    m.rewind(100);
    m.sync(320);
    // Host 260 was mix time 260, which the mix now reaches at host 460.
    const ahead = { ...m.project(260).probe(a) };
    m.sync(460);
    expect(m.probe(a)).toEqual(ahead);
  });
});

describe('rewind, by mix time where voice time runs back', () => {
  /** A spring whose host makes `calls` at each frame up to `until`, and the x it shows at each. */
  const sprung = (
    calls: (s: ReturnType<typeof spring<Part, Pose>>, h: Handle<Part>, t: number) => void,
    until = Infinity,
  ) => {
    const s = spring<Part, Pose>('x', { from: 0, to: 100 });
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    const h = m.cue({ patch: s });
    const seen = new Map<number, number[]>();
    for (const t of every(0, 800, 16)) {
      m.sync(t);
      if (t <= until) calls(s, h, t);
      seen.set(t, [m.probe(a).x, m.probe(b).x]);
    }
    return { m, seen };
  };
  const replays = (calls: Parameters<typeof sprung>[0]) => {
    const live = sprung(calls);
    const ref = sprung(calls, 208);
    live.m.rewind(208);
    for (const f of every(224, 800, 16)) {
      live.m.sync(800 + (f - 208));
      expect([live.m.probe(a).x, live.m.probe(b).x]).toEqual(ref.seen.get(f));
    }
  };

  it('cuts a retarget made after the moment, though a seek put its voice time before it', () =>
    replays((s, h, t) => {
      if (t === 304) h.seek(0);
      if (t === 352) s.to(a, -40);
    }));

  it('keeps a retarget made before the moment, though a seek put its voice time after it', () =>
    replays((s, h, t) => {
      if (t === 160) s.to(a, -40);
      if (t === 176) h.seek(0);
    }));

  it('cuts a retarget made after the moment for a subject no frame had met', () => {
    const c = { id: 'c' };
    const run = (retarget: boolean) => {
      const s = spring<Part, Pose>('x', { from: 0, to: 100 });
      const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
      m.cue({ patch: s });
      for (const t of every(0, 400, 16)) {
        m.sync(t);
        if (retarget && t === 304) s.to(c, -40);
        m.probe(a);
      }
      return m;
    };
    const live = run(true);
    const ref = run(false);
    live.rewind(208);
    for (const f of every(416, 800, 16)) {
      live.sync(400 + (f - 208));
      ref.sync(f);
      expect(live.probe(c).x).toBe(ref.probe(c).x);
    }
  });

  it('finds again whether a subject has rested, for a fade to rest', () => {
    const steps = patch<Part, Pose>(800, (p) => ({ x: p >= 0.5 ? 0 : 50 }), { writes: ['x'] });
    const frames = every(0, 640, 16);
    const run = () => {
      const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
      m.sync(0);
      const h = m.cue({ patch: steps });
      h.fade({ at: 'rest' });
      const states = new Map<number, string>();
      for (const t of frames) {
        m.sync(t);
        m.probe(a);
        states.set(t, h.state);
      }
      return { m, h, states };
    };
    const live = run();
    const ref = run();
    expect(live.h.state).toBe('done');
    live.m.rewind(304);
    for (const f of frames.filter((f) => f > 304)) {
      live.m.sync(640 + (f - 304));
      live.m.probe(a);
      expect(live.h.state).toBe(ref.states.get(f));
    }
  });
});

describe('sync', () => {
  it('refuses to go back, short of a rebase', () => {
    const m = mix<Part, Pose>(K);
    m.sync(100);
    expect(() => m.sync(50)).toThrow(/rewind/);
    m.sync(100);
    m.rebase();
    m.sync(20);
    m.sync(40);
  });
});

describe('project across a rebase', () => {
  it('reads a timestamp from before it at the moment it named then', () => {
    const rise = keys<Part, Pose>(1000, [
      { at: 0, delta: { x: 0 } },
      { at: 1, delta: { x: 100 } },
    ]);
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    m.cue({ patch: rise });
    m.sync(0);
    m.sync(200);
    m.rebase();
    m.sync(10_200);
    expect(m.probe(a).x).toBeCloseTo(20, 9);
    expect(m.project(200).probe(a).x).toBeCloseTo(20, 9);
  });
});
