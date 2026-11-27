import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { transport } from '../src/transport.js';

describe('a transport with no history and no mix, used as a clock', () => {
  it('keeps time from its first sync', () => {
    const t = transport();
    expect(t.now).toBeNaN();
    t.sync(1000);
    t.sync(1250);
    expect(t.now).toBe(250 + 1000);
  });

  it('seeks either way, moving its clock alone and keeping its rate and ramp', () => {
    const t = transport();
    t.sync(0);
    t.rate = 0.5;
    t.seek(500);
    expect([t.now, t.rate]).toEqual([500, 0.5]);
    t.sync(100);
    expect(t.now).toBe(550);
    t.seek(200);
    expect([t.now, t.rate]).toEqual([200, 0.5]);
    t.ramp(2, 100);
    t.sync(150);
    t.seek(1000);
    expect(t.rate).toBeCloseTo(1.25, 9);
    t.sync(200);
    expect(t.rate).toBe(2);
  });

  it('still needs history to seek once a mix is on it', () => {
    const t = transport();
    mix(kit<{ x: number }>({ x: sum() }), { transport: t });
    t.sync(0);
    expect(() => t.seek(100)).toThrow(/history/);
  });

  it('wakes its listeners on a rate, a ramp or a seek', () => {
    const t = transport();
    t.sync(0);
    let woke = 0;
    t.onWake(() => woke++);
    t.rate = 2;
    expect(woke).toBe(1);
    t.sync(16);
    t.ramp(1, 100);
    expect(woke).toBe(2);
    t.sync(32);
    t.seek(10);
    expect(woke).toBe(3);
  });
});

describe('a sync to an earlier timestamp', () => {
  it('counts no time and reads on from there', () => {
    const m = mix(kit<{ x: number }>({ x: sum() }), { name: 'back' });
    m.sync(1000);
    m.sync(1100);
    m.sync(900);
    expect(m.now).toBe(1100);
    m.sync(950);
    expect(m.now).toBe(1150);
  });

  it('does so on a transport with history, and seeks still restore', () => {
    const t = transport({ history: { ms: 1e6, tape } });
    t.sync(0);
    t.sync(500);
    t.sync(100);
    expect(t.now).toBe(500);
    t.sync(300);
    expect(t.now).toBe(700);
    t.seek(400);
    expect(t.now).toBe(400);
  });
});

describe('reading a ramp under way', () => {
  it('gives the rate it heads for and the host ms left, from the last sync', () => {
    const t = transport();
    t.sync(0);
    expect(t.ramping).toBeNull();
    t.ramp(2, 100);
    expect(t.ramping).toEqual({ to: 2, left: 100 });
    t.sync(40);
    expect(t.ramping).toEqual({ to: 2, left: 60 });
    t.sync(100);
    expect(t.ramping).toBeNull();
    t.ramp(0, 50);
    t.rate = 3;
    expect(t.ramping).toBeNull();
  });

  it('holds all of a ramp set before the first sync, and survives a seek on a bare clock', () => {
    const t = transport();
    t.ramp(0, 80);
    expect(t.ramping).toEqual({ to: 0, left: 80 });
    t.sync(1000);
    t.sync(1020);
    t.seek(5);
    expect(t.ramping).toEqual({ to: 0, left: 60 });
  });

  it('reads the same on a mix as on its transport', () => {
    const t = transport();
    const m = mix(kit<{ x: number }>({ x: sum() }), { transport: t, name: 'ramped' });
    t.sync(0);
    t.ramp(0.5, 200);
    t.sync(50);
    expect(m.ramping).toEqual({ to: 0.5, left: 150 });
    expect(t.ramping).toEqual(m.ramping);
  });
});

describe('a seek, below an ulp of host time', () => {
  it('leaves no trace in later syncs on a bare clock', () => {
    const run = (seeks: boolean) => {
      const t = transport();
      t.sync(0);
      t.rebase();
      t.sync(0);
      if (seeks) {
        t.seek(5e-324);
        t.seek(0);
      }
      t.ramp(1, 0);
      t.rebase();
      t.sync(0);
      t.sync(5e-324);
      return t.now;
    };
    expect(run(true)).toBe(run(false));
  });

  it('leaves time at the last sync equal to now once a drive ends', () => {
    const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape }, seek: 'jump' });
    mix(kit<{ x: number }>({ x: sum() }), { transport: t, name: 'driven' });
    t.sync(0);
    t.rebase();
    t.ramp(-5e-324, 0);
    t.seek(100);
    t.sync(0);
    t.sync(5e-324);
    t.rebase();
    t.seek(0);
    t.ramp(1, 0);
    t.sync(16.7);
    expect(t.time(16.7)).toBe(t.now);
  });

  it('jumps a seek ahead at a rate too slow for host time to count its way there', () => {
    const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape } });
    mix(kit<{ x: number }>({ x: sum() }), { transport: t, name: 'slow' });
    t.sync(0);
    t.rate = 1e-300;
    t.seek(100);
    t.rate = 1;
    t.sync(16);
    expect(t.now).toBe(116);
  });

  it('predicts no time below where running back stops', () => {
    const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape } });
    mix(kit<{ x: number }>({ x: sum() }), { transport: t, name: 'back' });
    for (let at = 0; at <= 100; at += 20) t.sync(at);
    t.rate = -1;
    expect(t.time(1000)).toBe(0);
  });
});

describe('the earliest time a seek reaches', () => {
  it('is where a seek lands and a seek before it throws, under history in memory', () => {
    const t = transport({ history: { ms: 100, tape } });
    mix(kit<{ x: number }>({ x: sum() }), { transport: t, name: 'reached' });
    expect(t.horizon).toBeNaN();
    for (let at = 0; at <= 500; at += 16) t.sync(at);
    const horizon = t.horizon;
    expect(horizon).toBeGreaterThanOrEqual(t.now - 100);
    expect(() => t.seek(horizon - 1)).toThrow(/older than/);
    t.seek(horizon);
    expect(t.now).toBe(horizon);
  });

  it('starts at the first sync', () => {
    const t = transport({ history: { ms: 1e6, tape } });
    mix(kit<{ x: number }>({ x: sum() }), { transport: t, name: 'young' });
    t.sync(40);
    t.sync(56);
    expect(t.horizon).toBe(40);
    t.rate = 0;
    t.sync(72);
    t.sync(88);
    expect(t.horizon).toBe(40);
  });

  it('is unbounded on a bare clock, and NaN for a mix without history', () => {
    const t = transport();
    expect(t.horizon).toBeNaN();
    t.sync(0);
    expect(t.horizon).toBe(Number.NEGATIVE_INFINITY);
    const m = mix(kit<{ x: number }>({ x: sum() }), { name: 'unseekable' });
    m.sync(0);
    expect(m.horizon).toBeNaN();
  });
});

describe('inert on a transport with no mix', () => {
  it('is its clock at rest: rate 0, no ramp, nothing since the last sync', () => {
    const t = transport();
    t.sync(0);
    expect(t.inert).toBe(false);
    t.rate = 0;
    expect(t.inert).toBe(false);
    t.sync(16);
    expect(t.inert).toBe(true);
    t.seek(50);
    expect(t.inert).toBe(false);
    t.sync(32);
    expect(t.inert).toBe(true);
    t.ramp(1, 100);
    t.sync(48);
    expect(t.inert).toBe(false);
    t.ramp(0, 10);
    t.sync(52);
    expect(t.inert).toBe(false);
    t.sync(64);
    expect(t.inert).toBe(true);
  });
});
