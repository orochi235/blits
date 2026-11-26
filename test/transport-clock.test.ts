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
