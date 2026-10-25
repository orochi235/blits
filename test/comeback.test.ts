import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring, tween } from '../src/motion.js';
import type { Handle, Mix } from '../src/types.js';

interface Pose {
  x: number;
}
interface Part {
  id: string;
}
const K = kit<Pose>({ x: sum() });
const a = { id: 'a' };

type Leave = 'fade' | 'ramp' | 'drop';
type Law = 'tween' | 'spring';
interface Play {
  leave: Leave;
  law: Law;
  lanes: boolean;
  every?: number;
  /** Whether a `to` at 300 brings it back. */
  back?: boolean;
  /** Whether frames between 100 and 300 leave it unprobed. */
  sparse?: boolean;
}

/**
 * Plays a motion voice on `a` from 0, retargets it at 40, takes it out at 100 (faded at once,
 * faded over 60, or dropped), and brings it back with a `to` at 300. Returns what each frame read.
 */
function play({ leave, law, lanes, every, back = true, sparse = false }: Play) {
  const m = mix<Part, Pose>(K, { lanes, history: { ms: 5000, tape, every } });
  const p =
    law === 'tween'
      ? tween<Part, Pose>('x', { from: 0, to: 100, ms: 400, ease: 'linear' })
      : spring<Part, Pose>('x', { from: 0, to: 100 });
  let h: Handle<Part> | undefined;
  const seen = new Map<number, number>();
  for (let t = 0; t <= 600; t += 20) {
    m.sync(t);
    if (t === 0) h = m.cue({ patch: p });
    if (t === 40) p.to(a, 200);
    if (t === 100) {
      if (leave === 'drop') m.drop(a);
      else h?.fade({ subject: a, over: leave === 'ramp' ? 60 : 0 });
    }
    if (back && t === 300) p.to(a, 40);
    if (!sparse || t < 100 || t > 300) seen.set(t, m.probe(a).x);
  }
  return { m, seen, p };
}

const probeAt = (m: Mix<Part, Pose>, t: number) => m.project(t).probe(a).x;

const cases: Play[] = [];
for (const leave of ['fade', 'ramp', 'drop'] as Leave[])
  for (const law of ['tween', 'spring'] as Law[])
    for (const lanes of [true, false])
      for (const every of [undefined, 50])
        for (const back of [true, false]) cases.push({ leave, law, lanes, every, back });
const named = (c: Play) =>
  `${c.leave}, ${c.law}, lanes ${c.lanes}, every ${c.every}${c.back ? ', brought back' : ''}`;

describe('a subject read back to while it was out of a motion voice, before a `to` brought it back', () => {
  for (const c of cases) {
    it(`${named(c)}: project reads each frame as it played`, () => {
      const { m, seen } = play(c);
      for (const t of [20, 60, 80, 120, 140, 200, 280, 320, 400, 500])
        expect(probeAt(m, t), `project(${t})`).toBeCloseTo(seen.get(t) as number, 9);
    });

    it(`${named(c)}: seek reads the frame, and plays on as it played`, () => {
      for (const at of [60, 80, 200, 280]) {
        const { m, seen } = play(c);
        m.seek(at);
        expect(m.probe(a).x, `seek(${at})`).toBeCloseTo(seen.get(at) as number, 9);
        for (let t = at + 20; t <= 600; t += 20) {
          m.sync(600 + t - at);
          expect(m.probe(a).x, `seek(${at}) then ${t}`).toBeCloseTo(seen.get(t) as number, 9);
        }
      }
    });

    it(`${named(c)}: read back to a time nothing probed it while out`, () => {
      const { m, seen } = play({ ...c, sparse: true });
      const whole = play(c).seen;
      for (const t of [60, 400]) expect(probeAt(m, t)).toBeCloseTo(seen.get(t) as number, 9);
      for (const t of [120, 200, 280]) expect(probeAt(m, t), `project(${t})`).toBe(whole.get(t));
      m.seek(200);
      expect(m.probe(a).x).toBe(whole.get(200));
    });
  }

  it('reads it as out, not as never having left', () => {
    const { m, seen } = play({ leave: 'fade', law: 'tween', lanes: true });
    expect(seen.get(200)).toBe(0);
    expect(probeAt(m, 200)).toBe(0);
    expect(seen.get(320)).not.toBe(0);
  });

  it('leaves the patch holding nothing for a subject read back to before it left', () => {
    const { m, p } = play({ leave: 'fade', law: 'tween', lanes: false, back: false });
    probeAt(m, 60);
    expect((p as unknown as { motions: { holds(s: Part): boolean } }).motions.holds(a)).toBe(false);
  });
});

describe('a motion change given a time before the frame it was made in, read back to between', () => {
  for (const lanes of [true, false])
    for (const leave of ['none', 'drop', 'fade'] as const)
      it(`reads what played until the call${lanes ? '' : ', lanes off'}, ${leave}`, () => {
        const m = mix<Part, Pose>(K, { lanes, history: { ms: 5000, tape } });
        const p = tween<Part, Pose>('x', { from: 0, to: 100, ms: 400, ease: 'linear' });
        const seen = new Map<number, number>();
        let h: Handle<Part> | undefined;
        for (let t = 0; t <= 600; t += 20) {
          m.sync(t);
          if (t === 0) h = m.cue({ patch: p });
          if (t === 100 && leave === 'drop') m.drop(a);
          if (t === 100 && leave === 'fade') h?.fade({ subject: a, over: 0 });
          if (t === 300) p.to(a, 40, 200);
          seen.set(t, m.probe(a).x);
        }
        for (const t of [180, 240, 280, 300, 320])
          expect(probeAt(m, t), `project(${t})`).toBeCloseTo(seen.get(t) as number, 9);
        m.seek(240);
        expect(m.probe(a).x).toBeCloseTo(seen.get(240) as number, 9);
      });
});
