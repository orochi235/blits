import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import type { Handle, Mix, MixOptions } from '../src/types.js';

interface Pose {
  x: number;
  y: number;
}
const K = kit<Pose>({ x: sum(), y: sum() });
interface Part {
  id: string;
}
const a = { id: 'a' };
const b = { id: 'b' };

/** x reads the voice's own elapsed ms, so a pose shows the voice clock. */
const clock = patch<Part, Pose>(0, (_p, _s, setting) => ({ x: setting.elapsed }), {
  writes: ['x'],
});
const ten = patch<Part, Pose>(0, () => ({ y: 10 }), { writes: ['y'] });
const ramp = keys<Part, Pose>(100, [
  { at: 0, delta: { y: 0 } },
  { at: 1, delta: { y: 10 } },
]);
// Integrates toward 50, so its value depends on the steps it was handed, not on where its clock is.
const drift = () =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
  });

const x = (m: Mix<Part, Pose>, at: number, part = a): number => {
  m.sync(at);
  return m.probe(part).x;
};

describe('mix.owns', () => {
  it('places a child on the owner’s clock, in ms from when the owner starts', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const intro = m.owns({ start: 1000 });
    m.cue({ patch: clock, owner: intro, start: 200 });
    expect(x(m, 1100)).toBe(0);
    expect(x(m, 1300)).toBe(100);
    expect(x(m, 1500)).toBe(300);
  });

  it('starts a child with no start where the owner’s clock is when it is cued', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const intro = m.owns({});
    m.sync(400);
    m.cue({ patch: clock, owner: intro });
    expect(x(m, 400)).toBe(0);
    expect(x(m, 650)).toBe(250);
  });

  it('resolves a bare name in a child’s anchor among its siblings', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: ramp, loop: false, name: 'slide', start: 0 });
    const intro = m.owns({ start: 500 });
    m.cue({ patch: ramp, loop: false, name: 'slide', owner: intro, start: 0 });
    const glow = m.cue({ patch: clock, owner: intro, anchor: { start: { after: 'slide' } } });
    m.sync(300);
    expect(glow.state).toBe('pending');
    // The sibling ends at its owner's 100 ms, so mix 600; the root voice named slide ended at 100.
    expect(x(m, 650)).toBe(50);
    expect(m.marks(0, 2000).find((k) => k.voice === glow.id && k.mark === 'start')?.timestamp).toBe(
      600,
    );
  });

  it('multiplies its rate and ramp into each child’s own, nested owners included', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const outer = m.owns({ rate: 0.5 });
    const inner = m.owns({ owner: outer, rate: 0.5 });
    m.cue({ patch: clock, owner: inner, rate: 2 });
    expect(x(m, 400)).toBeCloseTo(200);
    outer.rate = 2;
    expect(x(m, 600)).toBeCloseTo(600);
    expect(inner.owner).toBe(outer);
    expect(outer.owner).toBeUndefined();

    // A ramp on the owner reads as a ramp on the child would.
    const n = mix<Part, Pose>(K);
    const p = mix<Part, Pose>(K);
    n.sync(0);
    p.sync(0);
    const o = n.owns({});
    n.cue({ patch: clock, owner: o });
    const plain = p.cue({ patch: clock });
    o.ramp(0, 400);
    plain.ramp(0, 400);
    for (const t of [100, 250, 400, 700]) expect(x(n, t)).toBeCloseTo(x(p, t), 9);
  });

  it("moves its children with a seek, and with state: 'keep' leaves their state where it is", () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const o = m.owns({});
    const c = m.cue({ patch: clock, owner: o, subjects: [a] });
    const d = m.cue({ patch: drift(), owner: o, subjects: [b] });
    expect(x(m, 100)).toBe(100);
    const before = x(m, 100, b);
    expect(o.seek(1000, { state: 'keep' })).toBe('held');
    expect(x(m, 100)).toBe(1000);
    expect(x(m, 100, b)).toBe(before);
    expect(x(m, 150)).toBe(1050);
    expect(c.state).toBe('live');
    expect(d.state).toBe('live');
  });

  it('rebuilds its children’s state with a seek', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const o = m.owns({});
    m.cue({ patch: drift(), owner: o, subjects: [b] });
    x(m, 100, b);
    expect(o.seek(1000)).toBe('stepped');
    // Fresh state, caught up over the child's 1000 ms in one step, which lands on 50.
    expect(x(m, 100, b)).toBe(50);
  });

  it('multiplies its weight, a number or a signal, and its fade into each child’s', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const o = m.owns({ weight: (s) => (s.id === 'a' ? 0.5 : 0.25), fade: { out: 100 } });
    m.cue({ patch: ten, owner: o, weight: 0.8 });
    m.sync(10);
    expect(m.probe(a).y).toBeCloseTo(4);
    expect(m.probe(b).y).toBeCloseTo(2);
    expect(o.weightOf(a)).toBeCloseTo(0.5);
    o.fade();
    m.sync(60);
    expect(m.probe(a).y).toBeCloseTo(2);

    const n = mix<Part, Pose>(K);
    n.sync(0);
    const p = n.owns({ weight: 0.5 });
    n.cue({ patch: ten, owner: p });
    n.sync(1);
    expect(n.probe(a).y).toBeCloseTo(5);
    p.weight = 0.2;
    n.sync(2);
    expect(n.probe(a).y).toBeCloseTo(2);
  });

  it('gives its hold to each child that has none of its own', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const o = m.owns({ freeze: 'after' });
    const held = m.cue({ patch: ramp, loop: false, owner: o });
    const own = m.cue({ patch: ramp, loop: false, owner: o, freeze: 'before', subjects: [b] });
    m.sync(300);
    expect(held.state).toBe('frozen');
    expect(m.probe(a).y).toBe(10);
    expect(own.state).toBe('done');
    expect(o.state).toBe('live');
    o.fade({ over: 0 });
    expect(held.state).toBe('done');
  });

  it('is played once every child has played, and leaves with its last child', async () => {
    const m = mix<Part, Pose>(K, { history: { ms: 1000 } });
    m.sync(0);
    const o = m.owns({});
    const first = m.cue({ patch: ramp, loop: false, owner: o });
    const second = m.cue({ patch: ramp, loop: 2, owner: o });
    let played: boolean | undefined;
    void o.played.then((p) => {
      played = p;
    });
    m.sync(150);
    await Promise.resolve();
    // Under history it stays with its owner, quiet, until the owner leaves.
    expect(first.state).toBe('live');
    expect(await first.played).toBe(true);
    expect(played).toBeUndefined();
    m.sync(250);
    await o.done;
    expect([first.state, second.state]).toEqual(['done', 'done']);
    expect(o.state).toBe('done');
    expect(played).toBe(true);
    expect(m.marks(0, 1000).find((k) => k.voice === o.id && k.mark === 'end')?.timestamp).toBe(200);
  });

  it.each([false, true])(
    'lists its out and end at its last child’s end while it plays, and its coast once it left, history %s',
    (kept) => {
      const m = mix<Part, Pose>(K, kept ? { history: { ms: 1000 } } : {});
      m.sync(0);
      const o = m.owns({ fade: { out: 100 } });
      m.cue({ patch: ramp, loop: false, owner: o, start: 150 });
      const marks = () =>
        m
          .marks(0, 1000)
          .filter((k) => k.voice === o.id)
          .map((k) => [k.mark, k.timestamp]);
      // It leaves with its last child, so over none of its own fade out.
      const all = [
        ['start', 0],
        ['in', 0],
        ['coast', 250],
        ['out', 250],
        ['end', 250],
      ];
      m.sync(100);
      expect(marks()).toEqual(all);
      // A voice that left is listed only within history's reach, an owner as any other.
      m.sync(300);
      expect(marks()).toEqual(kept ? all : []);
    },
  );

  it('keeps its coast through a seek back past a child that left', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 5000, tape } });
    m.sync(0);
    const o = m.owns({});
    m.cue({ patch: ramp, loop: false, owner: o, start: 0 });
    const late = m.cue({ patch: ramp, loop: false, owner: o, start: 50, fade: { out: 100 } });
    const coast = () => m.marks(0, 1000).find((k) => k.voice === o.id && k.mark === 'coast');
    m.sync(110);
    m.sync(120);
    expect(coast()?.timestamp).toBe(150);
    // Faded before its pass ends, the second child leaves the owner with no coast at all.
    late.fade();
    m.sync(250);
    expect(o.state).toBe('done');
    expect(coast()).toBeUndefined();
    // Marks are on the host clock, which the seek leaves at 250 as the mix's goes back to 110.
    m.seek(110);
    expect(coast()?.timestamp).toBe(150 + 140);
    // The fade made again takes it away again.
    m.sync(400);
    expect(late.state).toBe('done');
    expect(coast()).toBeUndefined();
  });

  it('has its out and end booked ahead, as a voice’s are', () => {
    const m = mix<Part, Pose>(K);
    let host = 0;
    const took: unknown[] = [];
    m.sync(0);
    const o = m.owns({});
    m.cue({ patch: ramp, loop: false, owner: o, start: 150 });
    m.book({
      clock: () => host,
      ahead: 100,
      late: Number.POSITIVE_INFINITY,
      take(item, when, lateBy) {
        if (!('hit' in item) && item.voice === o.id && item.mark !== 'start' && item.mark !== 'in')
          took.push([item.mark, when, lateBy]);
        return undefined;
      },
    });
    for (const t of [100, 200, 300]) {
      host = t;
      m.sync(t);
    }
    expect(took).toEqual([
      ['coast', 250, 0],
      ['out', 250, 0],
      ['end', 250, 0],
    ]);
  });

  it('lists no out or end while a child’s end is unknown', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const o = m.owns({});
    m.cue({ patch: ramp, loop: false, owner: o });
    m.cue({ patch: ramp, loop: true, owner: o });
    expect(
      m
        .marks(0, 5000)
        .filter((k) => k.voice === o.id)
        .map((k) => k.mark),
    ).toEqual(['start', 'in']);
  });

  it('takes its children with it when its fade ends, and plays false', async () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const o = m.owns({ fade: { out: 100 } });
    const c = m.cue({ patch: ten, owner: o });
    o.fade();
    m.sync(100);
    expect(c.state).toBe('done');
    expect(o.state).toBe('done');
    expect(await o.played).toBe(false);
    expect(m.live).toBe(false);
  });

  it('refuses a loop, and a handle that is not an owner on this mix', () => {
    const m = mix<Part, Pose>(K);
    expect(() => m.owns({ loop: true } as never)).toThrow(/loop/);
    const voice = m.cue({ patch: ten });
    expect(() => m.cue({ patch: ten, owner: voice })).toThrow(/owner/);
    const other = mix<Part, Pose>(K).owns({});
    expect(() => m.cue({ patch: ten, owner: other })).toThrow(/owner/);
    const o = m.owns({});
    o.fade({ over: 0 });
    expect(() => m.cue({ patch: ten, owner: o })).toThrow(/left/);
    const p = m.owns({});
    expect(() => p.fade({ subject: a })).toThrow(/whole/);
  });

  it('lists owners and children alike in voices', () => {
    const m = mix<Part, Pose>(K);
    const o = m.owns({ tags: ['t'] });
    const c = m.cue({ patch: ten, owner: o, tags: ['t'] });
    expect(m.voices('t')).toEqual([o, c]);
  });

  it('maps a child’s marks to the host clock through its owners, and lists none while one is unfixed', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const o = m.owns({ start: 1000, rate: 0.5 });
    const c = m.cue({ patch: ramp, loop: false, owner: o, start: 100 });
    const at = (mark: string) =>
      m.marks(0, 5000).find((k) => k.voice === c.id && k.mark === mark)?.timestamp;
    expect(at('start')).toBe(1200);
    expect(at('end')).toBe(1400);
    const w = m.owns({ anchor: { start: { with: 'never' } } });
    const d = m.cue({ patch: ramp, loop: false, owner: w, start: 0 });
    expect(m.marks(0, 5000).some((k) => k.voice === d.id)).toBe(false);
  });

  it('reads back and ahead through an owner’s changes as the live mix played them', () => {
    const frames = [0, 50, 100, 150, 200, 250, 300, 350, 400];
    const m = mix<Part, Pose>(K, { history: { ms: 1000 } });
    const live = new Map<number, Pose>();
    let o: Handle<Part> | undefined;
    for (const t of frames) {
      m.sync(t);
      if (t === 0) {
        o = m.owns({ fade: { out: 200 } });
        m.cue({ patch: clock, owner: o });
        m.cue({ patch: ten, owner: o });
      }
      // A change between frames shows from the next one, live and read back alike.
      live.set(t, { ...m.probe(a) });
      if (t === 100) (o as Handle<Part>).rate = 0.5;
      if (t === 150) (o as Handle<Part>).seek(20);
      if (t === 200) (o as Handle<Part>).weight = 0.5;
      if (t === 250) (o as Handle<Part>).fade();
    }
    for (const t of frames.slice(0, -1)) {
      const back = m.project(t).probe(a);
      expect(back.x).toBeCloseTo((live.get(t) as Pose).x, 9);
      expect(back.y).toBeCloseTo((live.get(t) as Pose).y, 9);
    }

    const n = mix<Part, Pose>(K);
    n.sync(0);
    const p = n.owns({ rate: 0.5, fade: { out: 200 } });
    n.cue({ patch: clock, owner: p });
    n.sync(100);
    p.fade();
    const ahead = n.project(200).probe(a);
    n.sync(200);
    expect(ahead).toEqual(n.probe(a));
  });

  it('gives lanes the same poses as the general path', () => {
    const scene = (opts: MixOptions) => {
      const m = mix<Part, Pose>(K, opts);
      const out: number[] = [];
      m.sync(0);
      const o = m.owns({ rate: 0.75, fade: { in: 120, out: 80 } });
      const inner = m.owns({ owner: o, start: 30, weight: 0.6 });
      m.cue({ patch: ramp, owner: o, stagger: (s) => (s.id === 'a' ? 0 : 40) });
      m.cue({ patch: clock, owner: inner, fade: { in: 50 } });
      for (let t = 0; t <= 600; t += 16) {
        m.sync(t);
        if (t === 160) o.ramp(1.5, 100);
        if (t === 320) inner.seek(10);
        if (t === 480) o.fade();
        for (const s of [a, b]) {
          const pose = m.probe(s);
          out.push(pose.x, pose.y);
        }
      }
      return out;
    };
    expect(scene({})).toEqual(scene({ lanes: false }));
  });
});

describe.each([true, false])('an owner cued partway or backward, lanes %s', (lanes) => {
  it('starts its clock at its seek, and its children with it', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const o = m.owns({ seek: 200 });
    m.cue({ patch: clock, owner: o, start: 0 });
    expect(x(m, 0)).toBe(200);
    expect(x(m, 100)).toBe(300);
  });

  it('cued backward from a seek, plays its children back to their start and leaves with them', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const o = m.owns({ rate: -1, seek: 300 });
    const c = m.cue({ patch: ramp, loop: false, owner: o, start: 0 });
    // The child ends at its owner's 100 ms: past its end, it shows nothing until mix 200.
    expect(m.probe(a).y).toBe(0);
    m.sync(250);
    expect(m.probe(a).y).toBeCloseTo(5, 9);
    expect(m.marks(0, 1000).find((k) => k.voice === c.id && k.mark === 'end')?.timestamp).toBe(300);
    m.sync(310);
    expect([c.state, o.state]).toEqual(['done', 'done']);
  });

  it('turned back past its children’s end, shows each nothing until it reaches it', () => {
    const m = mix<Part, Pose>(K, { lanes });
    // A child per subject, each naming its one, so on lanes they share a crowd.
    const parts = [a, ...Array.from({ length: 5 }, (_, i) => ({ id: `${i}` }))];
    m.sync(0);
    const o = m.owns({});
    for (const p of parts) m.cue({ patch: ramp, loop: false, owner: o, start: 0, subjects: [p] });
    const shown = [0, 50, 100, 150, 200, 250].map((t) => {
      m.sync(t);
      if (t === 50) {
        o.seek(250);
        o.rate = -1;
      }
      for (const p of parts) m.probe(p);
      return m.probe(a).y;
    });
    expect(shown).toEqual([0, 0, 0, 0, 10, 5]);
  });

  it('cued backward with no seek, runs back from 0, so a child at 0 leaves at once', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const o = m.owns({ rate: -1 });
    const c = m.cue({ patch: ramp, loop: false, owner: o, start: 0 });
    m.sync(16);
    expect([c.state, o.state]).toEqual(['done', 'done']);
    expect(m.probe(a).y).toBe(0);
  });
});
