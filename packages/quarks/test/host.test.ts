import { kit, type Mix, mix } from '@msb235/blits';
import { ConeEmitter, type ConstantValue, IntervalValue } from 'three.quarks';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { born, failing, hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);
const a: Spot = { id: 'a' };
const b: Spot = { id: 'b' };

function run(frames: number, dt: number, m: Mix<Spot, Emission>, w: () => void, from = 0) {
  for (let f = 0; f <= frames; f++) {
    m.sync(from + f * dt);
    w();
  }
}

describe('what write reports', () => {
  it('returns how many particles each subject emitted, bursts included', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    q.attach(b, s, { at: [0, 0, 0] });
    m.sync(0);
    expect([...q.write()]).toEqual([]);
    m.sync(250);
    q.burst(b, 3.7);
    expect([...q.write()]).toEqual([
      [a, 2],
      [b, 3],
    ]);
    m.sync(290);
    expect([...q.write()]).toEqual([]);
  });

  it('keeps the counts of a write that throws in `emitted`, leaving out the subject that threw', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    const fail = { on: false };
    const t = system();
    t.addBehavior(failing(fail));
    m.cue({ patch: hold({ rate: 10 }), subjects: [a, b] });
    const q = drive(m, { kit: K });
    q.attach(a, t, { at: [0, 0, 0] });
    q.attach(b, s, { at: [0, 0, 0] });
    m.sync(0);
    q.write();
    fail.on = true;
    m.sync(100);
    expect(() => q.write()).toThrow('behavior failed');
    expect([...q.emitted]).toEqual([[b, 1]]);
  });
});

describe('a rate the host sets', () => {
  it('adds to the pose, unscaled by weight, and emits at weight 0', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    const v = m.cue({ patch: hold({ rate: 10 }), subjects: [a], weight: 0.5 });
    const q = drive(m, { kit: K });
    let level = 20;
    q.attach(a, s, { at: [0, 0, 0], rate: () => level });
    run(10, 100, m, () => q.write());
    expect(s.particleNum).toBe(25);
    v.weight = 0;
    level = 10;
    run(10, 100, m, () => q.write(), 1100);
    expect(s.particleNum).toBe(36);
  });

  it('takes a number, and treats one at or below 0 or not finite as 0', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0], rate: 5 });
    q.attach(b, s, { at: [0, 0, 0], rate: () => Number.NaN });
    run(10, 100, m, () => q.write());
    expect(s.particleNum).toBe(5);
  });

  it('reaches an emitter through `at`', () => {
    const m = mix<unknown, Emission>(K);
    const q = drive(m, { kit: K });
    const src = q.wire(system());
    const e = src.at([0, 0, 0], { rate: 10 });
    for (let f = 0; f <= 10; f++) {
      m.sync(f * 100);
      q.write();
    }
    expect(src.system.particleNum).toBe(10);
    expect(m.probe(e).rate).toBe(0);
  });
});

describe('capture', () => {
  it('captures once at attach by default, ignoring later edits', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10, speed: 2 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(1, 100, m, () => q.write());
    (s.startSpeed as ConstantValue).value = 8;
    m.sync(200);
    q.write();
    expect(born(s).map((p) => p.startSpeed)).toEqual([10, 10]);
    expect((s.startSpeed as ConstantValue).value).toBe(5);
  });

  it("at 'write', reads edits and replaced generators made between writes", () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10, speed: 2, size: 3 }), subjects: [a] });
    const q = drive(m, { kit: K, capture: 'write' });
    q.attach(a, s, { at: [0, 0, 0] });
    run(1, 100, m, () => q.write());
    (s.startSpeed as ConstantValue).value = 8;
    s.startSize = new IntervalValue(1, 1);
    m.sync(200);
    q.write();
    expect(born(s).map((p) => p.startSpeed)).toEqual([10, 16]);
    expect(born(s)[1]?.startSize.x).toBe(3);
    expect((s.startSpeed as ConstantValue).value).toBe(8);
    expect((s.startSize as IntervalValue).a).toBe(1);
    (s.startSpeed as ConstantValue).value = 9;
    q.detach(a);
    expect((s.startSpeed as ConstantValue).value).toBe(9);
  });

  it("at 'write', refuses a generator it cannot scale when it writes", () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    const q = drive(m, { kit: K, capture: 'write' });
    q.attach(a, s, { at: [0, 0, 0] });
    s.startSpeed = s.startLife;
    m.sync(0);
    expect(() => q.write()).toThrow(/share one generator/);
  });
});

describe('frame', () => {
  it("at 'world', emits at a pure translation, ignoring the emitter's rotation", () => {
    const m = mix<Spot, Emission>(K);
    const s = system({ shape: new ConeEmitter({ radius: 0, angle: 0 }) });
    s.emitter.rotation.x = -Math.PI / 2;
    s.emitter.updateMatrixWorld(true);
    m.cue({ patch: hold({ rate: 10 }), subjects: [a, b] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [1, 2, 3], frame: 'world' });
    q.attach(b, s, { at: [0, 0, 0] });
    run(1, 100, m, () => q.write());
    const [p, r] = born(s);
    expect(p?.position.toArray()).toEqual([1, 2, 3]);
    expect(p?.velocity.toArray()).toEqual([0, 0, 5]);
    expect(r?.velocity.y).toBeCloseTo(5);
  });
});
