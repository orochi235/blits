import { kit, type Mix, mix } from '@msb235/blits';
import { ConeEmitter, ConstantValue } from 'three.quarks';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { born, failing, hold, type Spot, system } from './fixtures.js';

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

  it('counts exactly when the frame time is not a whole number of ms', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 7 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(1440, 1000 / 144, m, () => q.write(1000 / 144));
    expect(s.particleNum).toBe(70);
  });

  it('treats a rate that is not finite as 0', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    const inf = m.cue({ patch: hold({ rate: Number.POSITIVE_INFINITY }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(2, 100, m, () => q.write(100));
    expect(s.particleNum).toBe(0);
    inf.weight = 0;
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    m.sync(1000);
    q.write(100);
    expect(s.particleNum).toBe(1);
  });

  it("keeps the emitter's world rotation and puts the particles at the subject", () => {
    const m = mix<Spot, Emission>(K);
    const s = system({ shape: new ConeEmitter({ radius: 0, angle: 0 }) });
    s.emitter.rotation.x = -Math.PI / 2;
    s.emitter.updateMatrixWorld(true);
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [1, 2, 3] });
    run(1, 100, m, () => q.write(100));
    const [p] = born(s);
    expect(p?.velocity.y).toBeCloseTo(5);
    expect(p?.position.toArray()).toEqual([1, 2, 3]);
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

  it('puts the authored values back when `at` throws, and still emits the other subjects', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10, speed: 3 }), subjects: [a, b] });
    const q = drive(m, { kit: K });
    let gone = true;
    q.attach(a, s, {
      at: () => {
        if (gone) throw new Error('gone');
        return [1, 0, 0];
      },
    });
    q.attach(b, s, { at: [0, 2, 0] });
    m.sync(0);
    expect(() => q.write(100)).toThrow('gone');
    expect((s.startSpeed as ConstantValue).value).toBe(5);
    expect(born(s).map((p) => p.position.y)).toEqual([2]);
    gone = false;
    m.sync(100);
    q.write(100);
    expect(born(s).filter((p) => p.position.x === 1)).toHaveLength(1);
  });

  it('puts the authored values back when a behavior throws, so a later capture is clean', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    const fail = { on: true };
    s.addBehavior(failing(fail));
    m.cue({ patch: hold({ rate: 10, speed: 3 }), subjects: [a, b] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    m.sync(0);
    expect(() => q.write(100)).toThrow('behavior failed');
    expect((s.startSpeed as ConstantValue).value).toBe(5);
    fail.on = false;
    const q2 = drive(m, { kit: K });
    q2.attach(b, s, { at: [0, 0, 0] });
    m.sync(100);
    q.write(100);
    q2.write(100);
    // quarks has already added the particle whose behavior threw, so it is here too.
    expect([...new Set(born(s).map((p) => p.startSpeed))]).toEqual([15]);
    expect((s.startSpeed as ConstantValue).value).toBe(5);
  });

  it('refuses a subject attached twice', () => {
    const q = drive(mix<Spot, Emission>(K), { kit: K });
    q.attach(a, system(), { at: [0, 0, 0] });
    expect(() => q.attach(a, system(), { at: [0, 0, 0] })).toThrow(/attached/);
  });
});
