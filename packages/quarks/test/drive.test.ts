import { kit, type Mix, mix } from '@msb235/blits';
import { ConstantValue } from 'three.quarks';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { born, hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);
const a: Spot = { id: 'a' };
const b: Spot = { id: 'b' };

function run(frames: number, dt: number, m: Mix<Spot, Emission>, w: () => void) {
  for (let f = 0; f < frames; f++) {
    m.sync(f * dt);
    w();
  }
}

describe('drive', () => {
  it("gives each subject's particles its own start values and position on a shared system", () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10, speed: 2, life: 0.5 }), subjects: [a] });
    m.cue({ patch: hold({ rate: 20, speed: 3 }), subjects: [b] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [1, 0, 0] });
    q.attach(b, s, { at: () => ({ x: 0, y: 2, z: 0 }) });
    run(10, 100, m, () => q.write(100));
    const fromA = born(s).filter((p) => p.position.x === 1);
    const fromB = born(s).filter((p) => p.position.y === 2);
    expect(fromA).toHaveLength(10);
    expect(fromB).toHaveLength(20);
    for (const p of fromA) expect([p.startSpeed, p.life]).toEqual([10, 1]);
    for (const p of fromB) expect([p.startSpeed, p.life]).toEqual([15, 2]);
    expect((s.startSpeed as ConstantValue).value).toBe(5);
  });

  it('emits exactly rate × time over many frames for a fractional rate', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 2.5 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(1000, 16, m, () => q.write(16));
    expect(s.particleNum).toBe(40);
  });

  it('adds the offset to the position', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10, offset: [0, 0, 3] }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [1, 0, 0] });
    run(1, 100, m, () => q.write(100));
    expect(born(s).map((p) => p.position.toArray())).toEqual([[1, 0, 3]]);
  });

  it('emits nothing at a rate at or below 0, and builds no debt', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    const neg = m.cue({ patch: hold({ rate: -5 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(10, 100, m, () => q.write(100));
    expect(s.particleNum).toBe(0);
    neg.weight = 0;
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    m.sync(1000);
    q.write(100);
    expect(s.particleNum).toBe(1);
  });

  it("does not fire the system's own bursts when it emits", () => {
    const m = mix<Spot, Emission>(K);
    const s = system({
      emissionBursts: [
        { time: 0, count: new ConstantValue(7), cycle: 1, interval: 0.01, probability: 1 },
      ],
    });
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(1, 100, m, () => q.write(100));
    expect(s.particleNum).toBe(1);
  });

  it('stops a detached subject, and recaptures a system attached again', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10, speed: 2 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(1, 100, m, () => q.write(100));
    q.detach(a);
    m.sync(100);
    q.write(100);
    expect(s.particleNum).toBe(1);
    (s.startSpeed as ConstantValue).value = 8;
    q.attach(a, s, { at: [0, 0, 0] });
    m.sync(200);
    q.write(100);
    expect(born(s).map((p) => p.startSpeed)).toEqual([10, 16]);
  });

  it('refuses a subject attached twice', () => {
    const q = drive(mix<Spot, Emission>(K), { kit: K });
    q.attach(a, system(), { at: [0, 0, 0] });
    expect(() => q.attach(a, system(), { at: [0, 0, 0] })).toThrow(/attached/);
  });
});
