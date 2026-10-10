import { describe, expect, it } from 'vitest';
import { kit, last, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { slew } from '../src/signals.js';
import type { Handle, Mix } from '../src/types.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: number;
}
const a = { id: 0 };
const b = { id: 3 };

const wave = patch<Part, Pose>(
  400,
  (phase, s) => ({ x: Math.sin(phase * 2 * Math.PI) * 10 + s.id }),
  {
    writes: ['x'],
  },
);
const ramp = keys<Part, Pose>(300, [
  { at: 0, delta: { gain: 1 } },
  { at: 1, delta: { gain: 0.2 } },
]);

const FRAMES: number[] = [];
for (let t = 0; t <= 1000; t += 50) FRAMES.push(t);

type Scene = (m: Mix<Part, Pose>, t: number, handles: Record<string, Handle<Part>>) => void;

/** Plays a scene with no history, keeping what each frame showed for each subject. */
function play(scene: Scene, until = 1000) {
  const m = mix<Part, Pose>(K);
  const handles: Record<string, Handle<Part>> = {};
  const showed = new Map<number, Pose[]>();
  scene(m, Number.NaN, handles);
  for (const t of FRAMES) {
    if (t > until) break;
    m.sync(t);
    scene(m, t, handles);
    showed.set(t, [{ ...m.probe(a) }, { ...m.probe(b) }]);
  }
  return { m, showed };
}

const same = (got: Pose, want: Pose) => {
  expect(got.x).toBeCloseTo(want.x, 9);
  expect(got.gain).toBeCloseTo(want.gain, 9);
};

/** Voices that play, loop, wait and freeze, and never leave. */
const staying: Scene = (m, t) => {
  if (!Number.isNaN(t)) return;
  m.cue({ patch: wave, start: 0, fade: { in: 100 }, stagger: (s) => s.id * 40 });
  m.cue({ patch: ramp, start: 200, loop: 2, freeze: 'both' });
  m.cue({ patch: wave, start: 500, weight: 0.5, rate: 2 });
  m.cue({
    patch: ramp,
    start: 100,
    loop: false,
    freeze: 'after',
    weight: (s) => (s.id > 0 ? 0.5 : 1),
  });
};

describe('project back with no history', () => {
  it('reads every earlier frame as it showed, while every voice is stateless and none has left', () => {
    const { m, showed } = play(staying);
    for (const [t, [pa, pb]] of showed) {
      const then = m.project(t);
      expect(then.timestamp).toBe(t);
      same(then.probe(a), pa as Pose);
      same(then.probe(b), pb as Pose);
    }
    expect(m.project(425).assess(a)).toEqual({ x: 'exact', gain: 'exact' });
    same(m.probe(a), (showed.get(1000) as Pose[])[0] as Pose);
  });

  it('reads a time between frames as a mix synced there would', () => {
    const { m } = play(staying);
    for (const t of [0, 37, 219.5, 512, 777, 999]) {
      const fresh = mix<Part, Pose>(K);
      staying(fresh, Number.NaN, {});
      fresh.sync(t);
      same(m.project(t).probe(b), fresh.probe(b));
    }
  });

  it('reads back to a host’s change and no further', () => {
    const { m, showed } = play((mx, t) => {
      if (Number.isNaN(t)) mx.cue({ patch: wave, start: 0 });
      if (t === 600) mx.cue({ patch: ramp, start: 500, loop: false, freeze: 'after' });
    });
    for (const t of [600, 650, 1000])
      same(m.project(t).probe(a), (showed.get(t) as Pose[])[0] as Pose);
    expect(() => m.project(550)).toThrow(
      /needs a mix made with history: a mix changed or a voice left at 600/,
    );
  });

  it('refuses while a voice whose handle was written to is cued, and reads again once it has left', () => {
    const { m, showed } = play((mx, t, h) => {
      if (Number.isNaN(t)) {
        mx.cue({ patch: wave, start: 0 });
        h.ramp = mx.cue({ patch: ramp, start: 0, loop: true });
      }
      if (t === 300) (h.ramp as Handle<Part>).weight = 0.3;
      if (t === 600) h.ramp?.fade({ over: 100 });
    }, 650);
    expect(() => m.project(620)).toThrow(/voice 2 is cued, and its handle has been written to/);
    for (const t of [700, 750, 1000]) {
      m.sync(t);
      showed.set(t, [{ ...m.probe(a) }, { ...m.probe(b) }]);
    }
    for (const t of [700, 750]) same(m.project(t).probe(a), (showed.get(t) as Pose[])[0] as Pose);
    expect(() => m.project(650)).toThrow(/at 700/);
  });

  it('reads back to when a voice left and no further', () => {
    const { m, showed } = play((mx, t) => {
      if (!Number.isNaN(t)) return;
      mx.cue({ patch: wave, start: 0 });
      mx.cue({ patch: ramp, start: 0, loop: false, fade: { out: 60 } });
    });
    for (const t of [400, 700]) same(m.project(t).probe(a), (showed.get(t) as Pose[])[0] as Pose);
    // Its fade ended at 360, and the frame at 400 was the first without it.
    expect(() => m.project(380)).toThrow(/a voice left at 400/);
    expect(() => m.project(100)).toThrow(/history/);
  });

  it('reads a voice still fading as it was before its own end began the fade', () => {
    const { m, showed } = play((mx, t) => {
      if (!Number.isNaN(t)) return;
      mx.cue({ patch: ramp, start: 0, loop: false, fade: { out: 400 } });
    }, 500);
    for (const t of [0, 150, 300, 350, 450])
      same(m.project(t).probe(a), (showed.get(t) as Pose[])[0] as Pose);
  });

  it('reads back to a drop and to a touch, and no further', () => {
    const dropped = play((mx, t) => {
      if (Number.isNaN(t)) mx.cue({ patch: wave, start: 0, fade: { in: 400 } });
      if (t === 200) mx.drop(a);
    });
    expect(() => dropped.m.project(150)).toThrow(/at 200/);
    same(dropped.m.project(250).probe(a), (dropped.showed.get(250) as Pose[])[0] as Pose);
    same(dropped.m.project(250).probe(b), (dropped.showed.get(250) as Pose[])[1] as Pose);

    const touched = play((mx, t) => {
      if (Number.isNaN(t)) mx.cue({ patch: wave, start: 0 });
      if (t === 700) mx.touch();
    });
    expect(() => touched.m.project(650)).toThrow(/at 700/);
    expect(() => touched.m.project(700)).not.toThrow();
  });

  it('refuses a voice that keeps state, a motion, and a mix whose rate was set', () => {
    const stepped = mix<Part, Pose>(K);
    stepped.cue({
      patch: patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
        writes: ['x'],
        state: () => ({ x: 0 }),
        step: (s, dt) => {
          s.x += dt;
        },
      }),
    });
    const moving = mix<Part, Pose>(K);
    moving.cue({ patch: spring<Part, Pose>('x', { from: 0, to: 1 }) });
    const following = mix<Part, Pose>(K);
    following.cue({ patch: wave, weight: slew<Part>(() => 1, { riseMs: 300 }) });
    const paced = mix<Part, Pose>(K);
    paced.cue({ patch: wave });
    for (const m of [stepped, moving, following, paced]) {
      m.sync(0);
      m.probe(a);
      m.sync(100);
      m.probe(a);
    }
    paced.rate = 1;
    expect(() => stepped.project(50)).toThrow(/voice 1 is cued, and its patch keeps state/);
    expect(() => moving.project(50)).toThrow(/it plays a motion/);
    expect(() => following.project(50)).toThrow(/its patch or its weight keeps state/);
    expect(() => paced.project(50)).toThrow(/the mix's rate has been set/);
    for (const m of [stepped, moving, following]) expect(() => m.project(150)).not.toThrow();
  });

  it('refuses a voice an anchor places, an owner and what it holds, and a rest-less channel at a moving weight', () => {
    const ready = <P>(m: Mix<Part, P>) => {
      m.sync(0);
      m.probe(a);
      m.sync(100);
      return m;
    };
    const anchored = mix<Part, Pose>(K);
    anchored.cue({ patch: wave, name: 'lead', start: 0 });
    anchored.cue({ patch: ramp, anchor: { start: { with: 'lead' } } });
    expect(() => ready(anchored).project(50)).toThrow(/voice 2 is cued, and an anchor places it/);

    const owned = mix<Part, Pose>(K);
    owned.cue({ patch: wave, owner: owned.owns({}) });
    expect(() => ready(owned).project(50)).toThrow(/voice 1 is cued, and it is an owner/);

    type Tagged = { tag?: string };
    const TAGGED = kit<Tagged>({ tag: last<string>() });
    const says = patch<Part, Tagged>(0, () => ({ tag: 'on' }), { writes: ['tag'] });
    const fading = mix<Part, Tagged>(TAGGED);
    fading.cue({ patch: says, fade: { in: 200 } });
    expect(() => ready(fading).project(50)).toThrow(
      /a channel with no rest at a weight that moves/,
    );
    const steady = mix<Part, Tagged>(TAGGED);
    steady.cue({ patch: says, weight: 0.8 });
    expect(ready(steady).project(50).probe(a)).toEqual({ tag: 'on' });
  });
});
