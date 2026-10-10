import { describe, expect, it } from 'vitest';
import { kit, last, max, mul, sum, vec } from '../src/channels.js';
import { mixHex } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Mix } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
  dark: number;
  color: number;
  position: number[];
}
const PART = kit<Pose>({
  gain: mul(),
  crawl: sum(),
  dark: max(),
  color: last<number>({ lerp: mixHex }),
  position: vec(3, sum()),
});

interface Part {
  id: string;
}

const every: (keyof Pose)[] = ['gain', 'crawl', 'dark', 'color', 'position'];

// Values chosen so a shortcut past the fold shows: mul at 0.1 does not round-trip through
// 1 + (v - 1) * w, a sum of -0 folds to +0, and a negative max loses to rest.
const all = patch<Part, Pose>(
  1000,
  (phase) => ({
    gain: 0.1 + 0.3 * phase,
    crawl: -0,
    dark: -0.25,
    color: 0x336699,
    position: [phase, -0, 2],
  }),
  { writes: every },
);

/** Writes nothing, so cued beside a voice it changes no value, only how many voices reach. */
const inert = patch<Part, Pose>(0, () => ({}), { writes: [] });

/** Each channel the same value, by `Object.is`, element by element for an array. */
function expectSame(a: Partial<Pose>, b: Partial<Pose>): void {
  for (const key of every) {
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x) && Array.isArray(y)) {
      expect(x.length).toBe(y.length);
      x.forEach((v, i) => {
        expect(Object.is(v, y[i]), `${key}[${i}]: ${v} vs ${y[i]}`).toBe(true);
      });
    } else expect(Object.is(x, y), `${key}: ${x} vs ${y}`).toBe(true);
  }
}

/**
 * Plays one scenario on a subject alone with its voice, and again with an inert voice beside it,
 * probing at each time into a fresh pose and into a reused out object; every probe must agree.
 */
function agrees(cue: (m: Mix<Part, Pose>) => (t: number) => void, times: number[]): void {
  const part = { id: 'a' };
  const runs = [false, true].map((crowded) => {
    const m = mix<Part, Pose>(PART);
    const at = cue(m);
    if (crowded) m.cue({ patch: inert });
    const out = {} as Pose;
    return { m, at, out, fresh: [] as Pose[], reused: [] as Pose[] };
  });
  for (const t of times)
    for (const run of runs) {
      run.at(t);
      run.m.sync(t);
      run.fresh.push(run.m.probe(part));
      // Copied through: the next probe writes into the arrays `out` holds.
      run.reused.push(structuredClone(run.m.probe(part, run.out)));
    }
  const [alone, crowded] = runs as [(typeof runs)[0], (typeof runs)[0]];
  times.forEach((_, i) => {
    expectSame(alone.fresh[i] as Pose, crowded.fresh[i] as Pose);
    expectSame(alone.reused[i] as Pose, crowded.reused[i] as Pose);
    expectSame(alone.fresh[i] as Pose, alone.reused[i] as Pose);
  });
}

describe('a subject one voice reaches folds as it would beside others', () => {
  it('at full weight, against rest rather than written through', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: all });
    m.sync(0);
    const pose = m.probe({ id: 'a' });
    expect(Object.is(pose.gain, 1 * (1 + (0.1 - 1) * 1))).toBe(true);
    expect(pose.gain).not.toBe(0.1);
    expect(Object.is(pose.crawl, 0)).toBe(true);
    expect(pose.dark).toBe(0);
    expect(pose.color).toBe(0x336699);
    agrees(
      (mm) => {
        mm.cue({ patch: all });
        return () => {};
      },
      [0, 16, 500],
    );
  });

  it('at a weight below 1', () => {
    agrees(
      (m) => {
        m.cue({ patch: all, weight: 0.3 });
        return () => {};
      },
      [0, 16, 333],
    );
  });

  it('with a weight crossing the band a rest-less channel switches on', () => {
    agrees(
      (m) => {
        const h = m.cue({ patch: all });
        const w = [0.7, 0.5, 0.3, 0.5, 0.65];
        let n = 0;
        return () => {
          h.weight = w[n++] ?? 1;
        };
      },
      [0, 16, 32, 48, 64],
    );
  });

  it('fading in and out', () => {
    agrees(
      (m) => {
        const h = m.cue({ patch: all, fade: { in: 100, out: 100 } });
        return (t) => {
          if (t === 150) h.fade({ over: 200 });
        };
      },
      [0, 20, 60, 100, 150, 200, 300, 349],
    );
  });

  it('in a locus of one', () => {
    agrees(
      (m) => {
        const h = m.cue({ patch: all, locus: 'g' });
        const w = [1, 0.5, 0.2, 0.5];
        let n = 0;
        return () => {
          h.weight = w[n++] ?? 1;
        };
      },
      [0, 16, 32, 48],
    );
  });
});

describe('a reused out object', () => {
  it('is cleared of a rest-less value no voice writes now, and keeps nothing from last frame', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: all });
    const out = {} as Pose;
    m.sync(0);
    m.probe({ id: 'a' }, out);
    expect(out.color).toBe(0x336699);
    const was = out.position;
    h.weight = 0.2;
    m.sync(16);
    m.probe({ id: 'a' }, out);
    expect(out.color).toBeUndefined();
    // A stock array channel's value goes into the array `out` already holds.
    expect(out.position).toBe(was);
  });

  it('never writes into an array a probe with no out handed back', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: all });
    const out = {} as Pose;
    m.sync(0);
    const kept = m.probe({ id: 'a' }).position;
    const copy = [...kept];
    for (let t = 16; t < 200; t += 16) {
      m.sync(t);
      m.probe({ id: 'a' }, out);
      m.probe({ id: 'a' });
    }
    expect(kept).toEqual(copy);
  });
});

describe('a subject reached by one voice, then two, then one', () => {
  const counter = patch<Part, Pose, { n: number }>(
    0,
    (_p, _s, setting) => ({ crawl: setting.state.n }),
    {
      writes: ['crawl'],
      state: () => ({ n: 0 }),
      step: (st) => {
        st.n++;
      },
    },
  );

  it('keeps the first voice state across the second arriving and leaving', () => {
    const m = mix<Part, Pose>(PART);
    const part = { id: 'a' };
    m.cue({ patch: counter });
    m.sync(0);
    expect(m.probe(part).crawl).toBe(0);
    m.sync(16);
    expect(m.probe(part).crawl).toBe(1);
    const second = m.cue({ patch: counter });
    m.sync(32);
    // The second, met at 32, steps once from its start at 16.
    expect(m.probe(part).crawl).toBe(2 + 1);
    m.sync(48);
    expect(m.probe(part).crawl).toBe(3 + 2);
    second.fade();
    m.sync(64);
    expect(m.probe(part).crawl).toBe(4);
    expect(second.weightOf(part)).toBe(0);
  });

  it('takes the second into the fold only for the subject it targets', () => {
    const m = mix<Part, Pose>(PART);
    const a = { id: 'a' };
    const b = { id: 'b' };
    m.cue({ patch: all });
    m.sync(0);
    const before = m.probe(b);
    m.cue({ patch: counter, target: (s) => s === a });
    m.sync(16);
    m.sync(32);
    // Met at 32, it steps once from its start at 0.
    expect(m.probe(a).crawl).toBe(1);
    const after = m.probe(b);
    expect(Object.is(after.crawl, before.crawl)).toBe(true);
  });

  for (const locus of [undefined, 'g']) {
    it(`keeps a rest-less channel's band ${locus ? 'in a locus ' : ''}when an earlier voice goes live`, () => {
      const m = mix<Part, Pose>(PART);
      const part = { id: 'a' };
      // Cued first but starting later, so once live it comes first among the subject's voices.
      m.cue({ patch: patch(0, () => ({ crawl: 1 }), { writes: ['crawl'] }), start: 100 });
      const h = m.cue({ patch: all, locus });
      m.sync(0);
      h.weight = 0.7;
      m.sync(16);
      expect(m.probe(part).color).toBe(0x336699);
      h.weight = 0.5;
      m.sync(32);
      expect(m.probe(part).color).toBe(0x336699);
      m.sync(100);
      const pose = m.probe(part);
      expect(pose.crawl).toBe(1);
      expect(pose.color).toBe(0x336699);
      h.weight = 0.3;
      m.sync(116);
      expect(m.probe(part).color).toBeUndefined();
    });
  }
});
