import { describe, expect, it } from 'vitest';
import { kit, max, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring, tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { input, level, peak } from '../src/signals.js';
import { diverge, type SceneOptions, scene } from './fuzz/scene.js';

interface Sweep {
  name: string;
  options: SceneOptions;
  seeds: number;
  /** Seeds left out, each with why. */
  skip?: Record<number, string>;
}
const SWEEPS: Sweep[] = [
  { name: 'default', options: {}, seeds: 2000 },
  { name: 'many subjects', options: { many: true }, seeds: 1000 },
  { name: 'owners', options: { owners: true }, seeds: 2000 },
  { name: 'pull', options: { pull: true }, seeds: 1500 },
  {
    name: 'history',
    options: { history: true },
    seeds: 1000,
  },
];

describe('lanes on and off read the same', () => {
  for (const { name, options, seeds, skip = {} } of SWEEPS)
    it(`${name}: seeds 1..${seeds}`, () => {
      const failed: string[] = [];
      for (let seed = 1; seed <= seeds; seed++) {
        if (skip[seed]) continue;
        const d = diverge(scene(seed, options));
        if (d)
          failed.push(
            `seed ${seed}, options ${JSON.stringify(options)}, reading ${d.line}\n  off: ${d.off}\n  on:  ${d.on}`,
          );
      }
      expect(failed.slice(0, 3), 'shrink one with shrink(seed, options) in fuzz/scene.ts').toEqual(
        [],
      );
    });
});

interface Part {
  id: number;
}

const ramp = [
  { at: 0, delta: { x: 1 } },
  { at: 1, delta: { x: 2 } },
];

describe('divergences found in review, each a missed input or a side effect out of order', () => {
  it('#6: a level set between two probes in one frame reaches the second probe', () => {
    const read = (lanes: boolean) => {
      const m = mix<Part, { x: number }>(kit({ x: sum() }), { lanes });
      const a = { id: 0 };
      const b = { id: 1 };
      const l = level<Part>(1);
      m.cue({
        patch: keys(400, [
          { at: 0, delta: { x: 1 } },
          { at: 1, delta: { x: 2 } },
        ]),
        weight: l,
      });
      m.sync(82);
      m.probe(a);
      m.probe(b);
      m.sync(83);
      m.probe(b);
      l.set(0);
      return [m.probe(b).x, m.probe(a).x];
    };
    expect(read(true)).toEqual(read(false));
  });

  it('#15: project reads a subject faded out of a motion voice as gone, after a retarget meets it again', () => {
    const read = (lanes: boolean) => {
      const m = mix<Part, { gain: number }>(kit({ gain: mul() }), {
        lanes,
        history: { ms: 3000 },
      });
      const a = { id: 0 };
      const tw = tween<Part, { gain: number }>('gain', {
        from: 1.8,
        to: 0.8,
        ms: 300,
        ease: 'linear',
      });
      const h = m.cue({ patch: tw });
      m.sync(0);
      h.fade({ subject: a, over: 100 });
      m.sync(400);
      m.probe(a);
      m.sync(450);
      tw.to(a, 0.6);
      m.sync(550);
      m.probe(a);
      return m.project(400).probe(a).gain;
    };
    expect(read(true)).toBe(read(false));
  });

  it('#16: inert agrees for a motion voice at weight 0', () => {
    const read = (lanes: boolean) => {
      const m = mix<Part, { dark: number }>(kit({ dark: max() }), { lanes });
      m.cue({ patch: spring<Part, { dark: number }>('dark', { from: 0, to: 1 }), weight: 0 });
      const a = { id: 0 };
      return [0, 16, 33, 2000].map((t) => {
        m.sync(t);
        m.probe(a);
        return m.inert;
      });
    };
    expect(read(true)).toEqual(read(false));
  });
  it('an input signal blits cannot hear from, set between probes, reaches the next probe', () => {
    const read = (lanes: boolean) => {
      let v = 1;
      const m = mix<Part, { x: number }>(kit({ x: sum() }), { lanes });
      const [a, b] = [{ id: 0 }, { id: 1 }];
      m.cue({ patch: keys(400, ramp), weight: Object.assign(() => v, { input: true }) });
      return [82, 83, 84].flatMap((t) => {
        m.sync(t);
        const first = m.probe(a).x;
        v = v === 1 ? 0.5 : 1;
        return [first, m.probe(b).x, m.probe(a).x];
      });
    };
    expect(read(true)).toEqual(read(false));
  });

  it('an input of the host’s own, touched between probes, reaches the next probe from its lane', () => {
    const read = (lanes: boolean) => {
      let v = 1;
      const m = mix<Part, { x: number }>(kit({ x: sum() }), { lanes });
      const [a, b] = [{ id: 0 }, { id: 1 }];
      const weight = input<Part>(() => v);
      m.cue({ patch: keys(400, ramp), weight: peak(weight) });
      const got = [82, 83, 84].flatMap((t) => {
        m.sync(t);
        const first = m.probe(a).x;
        v = v === 1 ? 0.5 : 1;
        weight.touch();
        return [first, m.probe(b).x, m.probe(a).x];
      });
      const laned = (m as unknown as { lanes: { laned: unknown[] } | null }).lanes?.laned.length;
      return { got, laned };
    };
    const on = read(true);
    expect(on.got).toEqual(read(false).got);
    expect(on.laned).toBe(1);
  });

  it('a host field changed between probes reaches the next probe', () => {
    const read = (lanes: boolean) => {
      const host = { k: 1 };
      const m = mix<Part, { x: number }, typeof host>(kit({ x: sum() }), { lanes, host });
      const [a, b] = [{ id: 0 }, { id: 1 }];
      m.cue({
        patch: patch(1000, (_p, _s, st) => ({ x: st.host.k }), { writes: ['x'], reads: ['k'] }),
      });
      return [82, 83, 84].flatMap((t) => {
        m.sync(t);
        const first = m.probe(a).x;
        host.k++;
        return [first, m.probe(b).x, m.probe(a).x];
      });
    };
    expect(read(true)).toEqual(read(false));
  });

  it('project reads a subject faded out of a voice, then dropped, as out of it', () => {
    const read = (lanes: boolean) => {
      const m = mix<Part, { x: number }>(kit({ x: sum() }), { lanes, history: { ms: 3000 } });
      const a = { id: 0 };
      const h = m.cue({ patch: keys(1000, ramp) });
      m.sync(0);
      m.probe(a);
      h.fade({ subject: a, over: 100 });
      m.sync(300);
      m.probe(a);
      m.sync(400);
      m.drop(a);
      m.sync(500);
      return [m.project(300).probe(a).x, m.probe(a).x];
    };
    expect(read(true)).toEqual([0, 1.5]);
    expect(read(false)).toEqual([0, 1.5]);
  });
});
