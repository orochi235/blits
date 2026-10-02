import { kit, mix, patch } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { born, hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);
const a: Spot = { id: 'a' };
const b: Spot = { id: 'b' };

// Sends one burst of `count`, and holds speed at 4 for its subject.
const pop = (count = 3) =>
  patch<Spot, Emission, { sent: boolean }>(0, () => ({ speed: 4 }), {
    writes: ['speed'],
    state: () => ({ sent: false }),
    step: (st, _dt, _subject, setting) => {
      if (st.sent) return;
      st.sent = true;
      setting.send({ count });
    },
  });

describe('bursts', () => {
  it("fires a burst at its own subject, with that subject's values, beside its rate", () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: pop(), subjects: [a], tags: ['sparks'] });
    m.cue({ patch: hold({ rate: 10 }), subjects: [a, b] });
    const q = drive(m, { kit: K, bursts: 'sparks' });
    q.attach(a, s, { at: [1, 0, 0] });
    q.attach(b, s, { at: [0, 2, 0] });
    for (let f = 0; f < 3; f++) {
      m.sync(f * 100);
      q.write(100);
    }
    expect(
      born(s)
        .filter((p) => p.position.x === 1)
        .map((p) => p.startSpeed),
    ).toEqual(Array(6).fill(20));
    expect(
      born(s)
        .filter((p) => p.position.y === 2)
        .map((p) => p.startSpeed),
    ).toEqual(Array(3).fill(5));
  });

  it('drains only its own tag, and ignores a burst for a subject not attached', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: pop(), subjects: [a, b], tags: ['sparks'] });
    m.cue({ patch: pop(), subjects: [a], tags: ['other'] });
    const q = drive(m, { kit: K, bursts: 'sparks' });
    q.attach(a, s, { at: [0, 0, 0] });
    for (let f = 0; f < 3; f++) {
      m.sync(f * 100);
      m.probe(b);
      q.write(100);
    }
    expect(s.particleNum).toBe(3);
    expect(m.drain('other')).toHaveLength(1);
  });

  it('treats a count that is not finite as 0', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: pop(Number.POSITIVE_INFINITY), subjects: [a], tags: ['sparks'] });
    m.cue({ patch: pop(Number.NaN), subjects: [a], tags: ['sparks'] });
    const q = drive(m, { kit: K, bursts: 'sparks' });
    q.attach(a, s, { at: [0, 0, 0] });
    for (let f = 0; f < 3; f++) {
      m.sync(f * 100);
      q.write(100);
    }
    expect(s.particleNum).toBe(0);
  });

  it("emits later subjects' bursts when an earlier subject throws, then rethrows", () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: pop(), subjects: [a, b], tags: ['sparks'] });
    const q = drive(m, { kit: K, bursts: 'sparks' });
    q.attach(a, s, {
      at: () => {
        throw new Error('gone');
      },
    });
    q.attach(b, s, { at: [0, 2, 0] });
    m.sync(0);
    q.write(100);
    m.sync(100);
    expect(() => q.write(100)).toThrow('gone');
    expect(born(s).map((p) => p.position.y)).toEqual([2, 2, 2]);
  });
});
