import { createHistory as tape } from '@weasel-js/history';
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
  until = Number.POSITIVE_INFINITY,
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
const probes = (m: Mix<Part, Pose>) => [a, b].map((s) => ({ ...m.probe(s) }));

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

const kept = (): MixOptions => ({
  history: { ms: 5000, every: 50, tape },
  stepMs: 4,
});

/**
 * Seeks a run back to the frame the host synced at `t`, mix time `at`, and plays it on, each frame
 * equal to what the run showed there.
 */
function replays(run: ReturnType<typeof play>, frames: number[], t: number, at = t) {
  run.m.seek(at);
  expect(probes(run.m)).toEqual(run.poses.get(t));
  const last = frames[frames.length - 1] as number;
  for (const f of frames.filter((f) => f > t)) {
    run.m.sync(last + (f - t));
    expect(probes(run.m)).toEqual(run.poses.get(f));
  }
}

/** Where `busy` puts the mix clock at host time `t`: its rate halves at 640. */
const busyAt = (t: number) => (t <= 640 ? t : 640 + (t - 640) / 2);

describe('seek', () => {
  for (const lanes of [true, false])
    it(`plays the host's calls again as it plays on from where it went back to${lanes ? '' : ', without lanes'}`, () => {
      const frames = every(0, 1200, 16);
      for (const t of [208, 400, 496, 592, 656]) {
        const run = play(busy, frames, [a, b], { ...kept(), lanes });
        replays(run, frames, t, busyAt(t));
      }
    });

  it('goes forward through what it recorded, as a sync would', () => {
    const frames = every(0, 1200, 16);
    const run = play(busy, frames, [a, b], kept());
    run.m.seek(208);
    run.m.seek(608);
    expect(probes(run.m)).toEqual(run.poses.get(608));
    run.m.seek(304);
    expect(probes(run.m)).toEqual(run.poses.get(304));
    for (const f of frames.filter((f) => f > 304)) {
      run.m.sync(1200 + (f - 304));
      expect(probes(run.m)).toEqual(run.poses.get(f));
    }
  });

  it('goes ahead of anything recorded as a sync to there would', () => {
    const m = mix<Part, Pose>(K, kept());
    const twin = mix<Part, Pose>(K, kept());
    for (const x of [m, twin]) {
      x.cue({ patch: drift() });
      x.cue({ patch: wave });
    }
    for (const t of every(0, 100, 20)) {
      m.sync(t);
      twin.sync(t);
      expect(probes(m)).toEqual(probes(twin));
    }
    m.seek(300);
    twin.sync(300);
    expect(probes(m)).toEqual(probes(twin));
    // The host's clock reads on from its last sync: 150 later is mix 350.
    m.sync(150);
    twin.sync(350);
    expect(probes(m)).toEqual(probes(twin));
  });

  it('needs history with a tape, reaches only as far as history keeps, and not before the first sync', () => {
    const plain = mix<Part, Pose>(K);
    plain.sync(0);
    expect(() => plain.seek(0)).toThrow(/history/);
    const untaped = mix<Part, Pose>(K, { history: { ms: 500 } });
    untaped.sync(0);
    expect(() => untaped.seek(0)).toThrow(/tape/);
    const m = mix<Part, Pose>(K, { history: { ms: 500, tape } });
    expect(() => m.seek(0)).toThrow(/never synced/);
    m.cue({ patch: wave });
    for (const t of every(0, 1000, 100)) m.sync(t);
    expect(() => m.seek(400)).toThrow(/older/);
    expect(() => m.seek(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    m.seek(700);
    expect(m.probe(a).x).toBeCloseTo(-10, 9);
  });

  it('keeps the handles the host holds: a voice that left comes back on its own', async () => {
    const m = mix<Part, Pose>(K, kept());
    m.sync(0);
    const h = m.cue({ patch: wave, loop: false });
    const first = h.played;
    for (const t of every(0, 600, 20)) m.sync(t);
    expect(h.state).toBe('done');
    expect(await first).toBe(true);
    m.seek(200);
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

  it('holds a voice cued after the moment pending, and cues it again on its handle as the mix plays past', () => {
    const m = mix<Part, Pose>(K, kept());
    m.sync(0);
    m.cue({ patch: wave });
    m.sync(100);
    const later = m.cue({ patch: ramp });
    m.sync(200);
    const gain = m.probe(a).gain;
    m.seek(50);
    expect(later.state).toBe('pending');
    expect(m.voices()).toHaveLength(1);
    expect(m.probe(a).gain).toBe(1);
    // 150 of the host's ms later the mix reads 200, having cued it again at 100.
    m.sync(350);
    expect(later.state).toBe('live');
    expect(m.voices()).toEqual([m.voices()[0], later]);
    expect(m.probe(a).gain).toBe(gain);
  });

  it('plays a spring retarget made after the moment again, and one made before it for later', () => {
    const s = spring<Part, Pose>('x', { from: 0, to: 100 });
    const scene: Scene = (m, t) => {
      if (t === 0) m.cue({ patch: s });
      if (t === 96) s.to(a, 20, 500);
      if (t === 304) s.to(a, -40);
      if (t === 400) s.push(b, 300);
    };
    const frames = every(0, 800, 16);
    replays(play(scene, frames, [a, b], kept()), frames, 208);
  });

  it('drops undrained events from after the moment, and sends them again as it plays past it', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000, tape }, stepMs: 10 });
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
    expect(m.drain().map((e) => e.timestamp)).toEqual([100, 200, 300]);
    for (const t of every(320, 400, 20)) {
      m.sync(t);
      m.probe(a);
    }
    m.seek(300);
    expect(m.drain()).toEqual([]);
    for (const t of every(420, 520, 20)) {
      m.sync(t);
      m.probe(a);
    }
    expect(m.drain().map((e) => e.event)).toEqual([40]);
  });

  it('brings back a subject faded out of a voice after the moment as never seen, until the fade plays again', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000, tape }, stepMs: 5 });
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
    m.seek(180);
    m.sync(245);
    // Its record was forgotten, so it starts afresh from its voice's start, on the same grid.
    const fresh = mix<Part, Pose>(K, { stepMs: 5 });
    fresh.sync(0);
    fresh.cue({ patch: drift() });
    fresh.sync(185);
    expect(m.probe(a).x).toBeCloseTo(fresh.probe(a).x, 9);
    expect(h.weightOf(a)).toBe(1);
    m.sync(285);
    expect(h.weightOf(a)).toBe(0);
  });

  it('puts the mix rate and announced marks back, and makes the later ones again', () => {
    const m = mix<Part, Pose>(K, kept());
    m.cue({ patch: wave });
    m.sync(0);
    m.sync(100);
    m.announce('cue');
    m.sync(200);
    m.rate = 0.5;
    m.announce('late');
    m.sync(300);
    m.seek(100);
    expect(m.rate).toBe(1);
    const named = () =>
      m
        .marks(0, 1000)
        .filter((k) => k.voice === undefined)
        .map((k) => k.name);
    expect(named()).toEqual(['cue']);
    // 150 ms of the host's clock later: mix 200 at rate 1, then 50 more at 0.5.
    m.sync(450);
    expect(m.rate).toBe(0.5);
    expect(named()).toEqual(['cue', 'late']);
    expect(m.probe(a).x).toBeCloseTo(Math.sin((225 / 400) * 2 * Math.PI) * 10, 9);
  });

  it('books hits after the moment again as the mix reaches them again', () => {
    const m = mix<Part, Pose>(K, kept());
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
    m.seek(80);
    for (const t of every(220, 520, 20)) sync(t);
    expect(took.map((t) => [t.hit.event, t.hit.timestamp])).toEqual([
      ['a', 100],
      ['a', 220],
      ['b', 420],
    ]);
  });
});

describe('seek, branching', () => {
  const frames = every(0, 1200, 16);
  const weaker: Scene = (_m, t, h) => {
    if (t === 416) (h.drift as { weight: number }).weight = 0.2;
  };

  it('keeps the old future when the host makes a call after going back, and plays the new one', () => {
    const run = play(busy, frames, [a, b], kept());
    const ref = play(
      (m, t, h) => {
        if (t <= 400) busy(m, t, h);
        weaker(m, t, h);
      },
      frames,
      [a, b],
      kept(),
    );
    run.m.seek(400);
    run.m.sync(1216);
    weaker(run.m, 416, run.h);
    expect(probes(run.m)).toEqual(ref.poses.get(416));
    for (const f of frames.filter((f) => f > 416)) {
      run.m.sync(1200 + (f - 400));
      expect(probes(run.m)).toEqual(ref.poses.get(f));
    }
    // Back before the new call, the old future is there to pick.
    run.m.seek(408);
    const tape = run.m.tape;
    const branches = tape?.branches() ?? [];
    expect(branches.map((x) => [x.label, x.timestamp, x.current])).toEqual([
      ['seek', 480, false],
      ['weight', 416, true],
    ]);
    tape?.switchBranch((branches[0] as { id: number }).id);
    for (const f of frames.filter((f) => f > 408)) {
      run.m.sync(2000 + (f - 408));
      expect(probes(run.m)).toEqual(run.poses.get(f));
    }
  });
});

describe('seek, again and through owners', () => {
  it('goes back twice before a subject is read again, and plays on exactly', () => {
    const frames = every(0, 1200, 16);
    const run = play(busy, frames, [a, b], kept());
    run.m.seek(800);
    replays(run, frames, 304);
  });

  it('pulls what it probes after going back', () => {
    const live = play(busy, every(0, 800, 16), [a, b], kept());
    const x = new Float64Array(2);
    const gain = new Float64Array(2);
    live.m.pull([a, b], { x, gain });
    live.m.seek(400);
    live.m.sync(816);
    live.m.pull([a, b], { x, gain });
    expect([x[0], x[1]]).toEqual([live.m.probe(a).x, live.m.probe(b).x]);
    expect([gain[0], gain[1]]).toEqual([live.m.probe(a).gain, live.m.probe(b).gain]);
  });

  it('brings an owner back with its children, and has it play once they all have again', async () => {
    const m = mix<Part, Pose>(K, kept());
    m.sync(0);
    const o = m.owns({});
    const one = m.cue({ patch: wave, loop: false, owner: o });
    const two = m.cue({ patch: ramp, loop: false, owner: o });
    for (const t of every(20, 600, 20)) m.sync(t);
    expect([o.state, one.state, two.state]).toEqual(['done', 'done', 'done']);
    expect(await o.played).toBe(true);
    m.seek(350);
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

  it('cues an owner and its children again after going back before them', () => {
    const scene: Scene = (m, t, h) => {
      if (t === 0) m.cue({ patch: drift() });
      if (t === 96) {
        h.o = m.owns({ rate: 2 });
        m.cue({ patch: wave, owner: h.o });
        m.cue({ patch: ramp, owner: h.o, loop: false });
      }
      if (t === 192) (h.o as { weight: number }).weight = 0.5;
    };
    const frames = every(0, 600, 16);
    replays(play(scene, frames, [a, b], kept()), frames, 48);
  });

  it('reads project by mix time, which a seek moves the host clock against', () => {
    const m = mix<Part, Pose>(K, kept());
    m.cue({ patch: wave });
    for (const t of every(0, 300, 20)) m.sync(t);
    m.seek(100);
    m.sync(320);
    const ahead = { ...m.project(260).probe(a) };
    m.sync(460);
    expect(m.probe(a)).toEqual(ahead);
  });
});

describe('seek, by mix time where voice time runs back', () => {
  /** A spring whose host makes `calls` at each frame, and the x it shows at each. */
  const sprung = (
    calls: (s: ReturnType<typeof spring<Part, Pose>>, h: Handle<Part>, t: number) => void,
  ) => {
    const s = spring<Part, Pose>('x', { from: 0, to: 100 });
    const frames = every(0, 800, 16);
    const run = play(
      (m, t, h) => {
        if (t === 0) h.s = m.cue({ patch: s });
        calls(s, h.s as Handle<Part>, t);
      },
      frames,
      [a, b],
      kept(),
    );
    replays(run, frames, 208);
  };

  it('plays a retarget made after the moment again, though a seek put its voice time before it', () =>
    sprung((s, h, t) => {
      if (t === 304) h.seek(0);
      if (t === 352) s.to(a, -40);
    }));

  it('keeps a retarget made before the moment, though a seek put its voice time after it', () =>
    sprung((s, h, t) => {
      if (t === 160) s.to(a, -40);
      if (t === 176) h.seek(0);
    }));

  it('plays a retarget made after the moment again for a subject no frame had met', () => {
    const c = { id: 'c' };
    const run = () => {
      const s = spring<Part, Pose>('x', { from: 0, to: 100 });
      const m = mix<Part, Pose>(K, kept());
      m.cue({ patch: s });
      for (const t of every(0, 400, 16)) {
        m.sync(t);
        if (t === 304) s.to(c, -40);
        m.probe(a);
      }
      return m;
    };
    const live = run();
    const ref = run();
    live.seek(208);
    for (const f of every(224, 800, 16)) {
      live.sync(400 + (f - 208));
      if (f >= 416) {
        ref.sync(f);
        expect(live.probe(c).x).toBe(ref.probe(c).x);
      }
    }
  });

  it('finds again whether a subject has rested, for a fade to rest', () => {
    const steps = patch<Part, Pose>(800, (p) => ({ x: p >= 0.5 ? 0 : 50 }), { writes: ['x'] });
    const frames = every(0, 640, 16);
    const run = () => {
      const m = mix<Part, Pose>(K, kept());
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
    live.m.seek(304);
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
    expect(() => m.sync(50)).toThrow(/seek/);
    m.sync(100);
    m.rebase();
    m.sync(20);
    m.sync(40);
  });
});

describe('project', () => {
  it('reads by mix time, which a rebase leaves where it was', () => {
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
    expect(m.project(100).probe(a).x).toBeCloseTo(10, 9);
  });
});
