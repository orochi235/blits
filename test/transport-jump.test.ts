import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { transport } from '../src/transport.js';

const K = kit<{ x: number }>({ x: sum() });
const line = patch<{ id: string }, { x: number }>(1000, (p) => ({ x: p * 1000 }), {
  writes: ['x'],
});

describe('a seek while the clock runs back', () => {
  it.each(['jump', 'play'] as const)('keeps a ramp under way, seeking by %s', (seek) => {
    const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape }, seek });
    mix(K, { name: 'back', transport: t });
    t.sync(0);
    t.rate = -0.05;
    t.ramp(0, 400);
    t.seek(100);
    t.sync(1000);
    expect(t.now).toBeCloseTo(90, 9);
    expect(t.rate).toBe(0);
  });
});

describe("a transport made with seek: 'jump'", () => {
  it('leaves a ramp under way where it stood on a seek ahead', () => {
    const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape }, seek: 'jump' });
    mix(K, { name: 'jumping', transport: t });
    t.sync(0);
    t.ramp(0, 0);
    t.ramp(0.5, 333.3);
    t.seek(100);
    expect(t.now).toBe(100);
    expect(t.rate).toBe(0);
  });

  it('plays a ramp out on a seek ahead by default', () => {
    const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape } });
    mix(K, { name: 'playing', transport: t });
    t.sync(0);
    t.ramp(0, 0);
    t.ramp(0.5, 333.3);
    t.seek(100);
    expect(t.rate).toBeGreaterThan(0);
  });

  it('still makes the recorded calls on the way, and shows the mix where it lands', () => {
    const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape }, seek: 'jump' });
    const m = mix<{ id: string }, { x: number }>(K, { name: 'jumping', transport: t });
    t.sync(0);
    t.sync(100);
    m.cue({ patch: line, loop: false });
    t.sync(300);
    t.seek(50);
    t.seek(400);
    expect(m.probe({ id: 'a' }).x).toBeCloseTo(300, 9);
  });
});
