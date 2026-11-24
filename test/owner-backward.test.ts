import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Handle, Mix, MixOptions } from '../src/types.js';
import { a, clock, K, type Part, type Pose, ramp, x } from './owner-fixtures.js';

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

  const kept = (history: boolean): MixOptions =>
    history ? { lanes, history: { ms: 5000, tape } } : { lanes };

  it.each([false, true])(
    'cued backward with no seek, a child placed after 0 leaves at once, history %s',
    (history) => {
      const m = mix<Part, Pose>(K, kept(history));
      m.sync(0);
      const o = m.owns({ rate: -1 });
      const c = m.cue({ patch: ramp, loop: false, owner: o, start: 50 });
      for (const t of [10, 100, 1000]) {
        m.sync(t);
        m.probe(a);
      }
      expect([c.state, o.state, m.live, m.inert]).toEqual(['done', 'done', false, true]);
    },
  );

  it.each([false, true])(
    'turned back with a child still to start, leaves at its start with the one it played, history %s',
    (history) => {
      const m = mix<Part, Pose>(K, kept(history));
      m.sync(0);
      const o = m.owns({});
      const played = m.cue({ patch: ramp, loop: false, owner: o, start: 0 });
      const ahead = m.cue({ patch: ramp, loop: false, owner: o, start: 500 });
      m.sync(50);
      o.rate = -1;
      m.sync(60);
      expect([played.state, ahead.state, o.state]).toEqual(['live', 'pending', 'live']);
      m.sync(100);
      expect([played.state, ahead.state, o.state, m.live]).toEqual(['done', 'done', 'done', false]);
      const end = (v: Handle<Part>) =>
        m.marks(0, 1000).find((k) => k.voice === v.id && k.mark === 'end')?.timestamp;
      if (history) expect([end(o), end(ahead)]).toEqual([100, 100]);
    },
  );

  it('turned back and forward again before its start, still starts a child placed ahead', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const o = m.owns({});
    m.cue({ patch: ramp, loop: false, owner: o, start: 0 });
    const ahead = m.cue({ patch: ramp, loop: false, owner: o, start: 500 });
    m.sync(50);
    o.rate = -1;
    m.sync(80);
    o.rate = 1;
    // Its clock reads 20 at 80, so 500 at 560.
    m.sync(550);
    expect(ahead.state).toBe('pending');
    m.sync(610);
    expect([ahead.state, o.state]).toEqual(['live', 'live']);
    expect(m.probe(a).y).toBeCloseTo(5, 9);
  });

  it('seeks back to before it turned, with the child still to start waiting again', () => {
    const m = mix<Part, Pose>(K, kept(true));
    m.sync(0);
    const o = m.owns({});
    const played = m.cue({ patch: ramp, loop: false, owner: o, start: 0 });
    const ahead = m.cue({ patch: ramp, loop: false, owner: o, start: 500 });
    m.sync(50);
    o.rate = -1;
    m.sync(200);
    expect([played.state, ahead.state, o.state]).toEqual(['done', 'done', 'done']);
    m.seek(40);
    expect([played.state, ahead.state, o.state, m.live]).toEqual(['live', 'pending', 'live', true]);
  });
});

describe('a child cued under an owner standing still', () => {
  const held = patch<string, { w: number }>(600, () => ({ w: 1 }), { writes: ['w'] });
  /** The child's weight a frame after its cue, under an owner that stood still since 33 or ran. */
  const weightAfterCue = (paused: boolean, lanes: boolean) => {
    const m = mix<string, { w: number }>(kit({ w: sum() }), { lanes });
    m.sync(0);
    const owner = m.span({ duration: 2000 });
    m.sync(33);
    if (paused) owner.rate = 0;
    m.sync(83);
    m.cue({ patch: held, subjects: ['b'], owner, fade: { in: 109 } });
    m.sync(84);
    return m.probe('b').w;
  };
  for (const lanes of [false, true])
    it(`fades in from its cue, not from where the owner stopped (lanes ${lanes})`, () => {
      expect(weightAfterCue(true, lanes)).toBeCloseTo(weightAfterCue(false, lanes), 9);
    });
});

describe('a child cued while the mix is rebased', () => {
  const ran = patch<string, { w: number }>(600, () => ({ w: 1 }), { writes: ['w'] });
  it('shows on the sync the mix resumes on, as a seek to that frame does', () => {
    const m = mix<string, { w: number }>(kit({ w: sum() }), { history: { ms: 1e5, tape } });
    m.sync(50);
    // Too short for the child, so the fit jumps it to its end, where it freezes.
    const owner = m.span({ duration: 665, order: 'together' });
    m.sync(100);
    m.sync(133);
    m.rebase();
    m.cue({ patch: ran, owner, freeze: 'after' });
    m.sync(883);
    const seq = m.seq;
    const shown = m.probe('s').w;
    m.seek({ frame: seq });
    expect(shown).toBe(1);
    expect(m.probe('s').w).toBe(shown);
  });
});

describe('a fading child its owner runs back before its start', () => {
  type W = { x: number; w: number };
  const KW = kit<W>({ x: sum(), w: sum() });
  const held = patch<string, W>(600, (_p, _s, st) => ({ x: st.elapsed, w: 1 }), {
    writes: ['x', 'w'],
  });
  type Act = (m: Mix<string, W>, t: number) => void;
  /** The poses of `b` and `c` at each of `times`, made from 0 with `act` run before each sync. */
  const poses = (lanes: boolean, times: number[], act: Act) => {
    const m = mix<string, W>(KW, { lanes });
    act(m, 0);
    m.sync(0);
    return times.map((t) => {
      act(m, t);
      m.sync(t);
      return [m.probe('b'), m.probe('c')];
    });
  };
  const same = (times: number[], act: Act) =>
    expect(poses(true, times, act)).toEqual(poses(false, times, act));

  it('shows nothing on lanes once a span run back passes it, on a crowd row', () => {
    let s: Handle<string>;
    same([33, 83, 100, 133, 166, 200], (m, t) => {
      if (t === 0) s = m.span({ duration: 316 });
      if (t === 83) s.rate = 0;
      if (t === 100)
        m.cue({ patch: held, subjects: ['b'], loop: false, owner: s, fade: { in: 109, out: 80 } });
      if (t === 166) s.rate = -1;
    });
  });

  it('holds the frame it starts on, on lanes, once its owner is sought back before it and it fades', () => {
    let o: Handle<string>;
    let c: Handle<string>;
    same([100, 200, 216, 232, 248, 264, 300], (m, t) => {
      if (t === 0) o = m.owns({});
      if (t === 200)
        c = m.cue({ patch: held, subjects: ['b'], loop: false, owner: o, freeze: 'before' });
      if (t === 216) c.seek(300);
      if (t === 232) o.seek(50);
      if (t === 248) c.fade({ over: 118 });
    });
  });

  it('shows nothing on lanes once its owner runs back past it, over every subject', () => {
    let o: Handle<string>;
    let c: Handle<string>;
    same([16, 50, 100, 116, 140, 180, 260], (m, t) => {
      if (t === 0) o = m.owns({});
      if (t === 16) c = m.cue({ patch: held, loop: false, owner: o });
      if (t === 50) c.seek(300);
      if (t === 100) o.rate = -1;
      if (t === 116) c.fade({ over: 230 });
    });
  });
});

describe.each([true, false])('an owner’s played, lanes %s', (lanes) => {
  it('settles with its last child held then, and a child cued after does not change it', async () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const o = m.owns({});
    m.cue({ patch: ramp, loop: false, owner: o, freeze: 'after' });
    m.sync(150);
    expect(await o.played).toBe(true);
    const late = m.cue({ patch: ramp, loop: false, owner: o });
    m.sync(170);
    late.fade({ over: 0 });
    expect(await late.played).toBe(false);
    expect(await o.played).toBe(true);
  });
});
