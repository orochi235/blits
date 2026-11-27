import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { transport } from '../src/transport.js';
import type { TransportOptions } from '../src/types.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const up = patch<string, Pose>(1000, (ph) => ({ x: 1 + ph }), { writes: ['x'] });

const made = (seek: TransportOptions['seek'] = 'jump') => {
  const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape }, seek });
  const m = mix<string, Pose>(K, { transport: t, name: 'jumped' });
  t.sync(0);
  t.rebase();
  return { t, m };
};
const named = (t: ReturnType<typeof made>['t']) =>
  t.marks(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY).map((m) => m.name);

describe('a seek ahead that jumped, then a seek back', () => {
  it('leaves a ramp made past the jump ahead of a later seek short of it', () => {
    const { t } = made();
    t.ramp(0, 0);
    t.seek(1e15);
    t.ramp(2, 1000);
    t.seek(0);
    t.ramp(0, 0);
    t.seek(100);
    t.sync(0);
    t.sync(100);
    expect(t.ramping).toBeNull();
    expect(t.now).toBe(100);
  });

  it('leaves a mark announced past the jump unannounced at a seek short of it', () => {
    const { t } = made();
    t.seek(1e15);
    t.announce('late', { score: 's' });
    t.seek(0);
    t.seek(100);
    expect(named(t)).toEqual([]);
  });

  it('plays on by mix time from short of the jump, at the rate the host gave it', () => {
    const { t } = made();
    t.seek(1e15);
    t.announce('late', { score: 's' });
    t.seek(0);
    t.seek(100);
    // The first sync after `made`'s rebase counts no time.
    t.sync(16);
    t.sync(32);
    expect(t.now).toBe(116);
    expect(named(t)).toEqual([]);
    t.seek(1e15 + 10);
    expect(named(t)).toEqual(['late']);
  });

  it('plays the jump again where it was made when the host plays on from before it', () => {
    const { t } = made('play');
    t.sync(16);
    t.sync(32);
    t.rate = 0;
    t.seek(5000);
    t.announce('there', { score: 's' });
    t.sync(48);
    t.seek(8);
    expect(t.rate).toBe(1);
    t.sync(64);
    t.sync(80);
    expect(t.now).toBeGreaterThanOrEqual(5000);
    expect(named(t)).toEqual(['there']);
  });

  it('leaves a cue past the jump out of a read ahead short of it, and in one past it', () => {
    const { t, m } = made();
    t.seek(1e15);
    m.cue({ patch: up, subjects: ['a'] });
    t.seek(0);
    expect(m.project(100).probe('a').x).toBe(0);
    expect(m.project(1e15 + 500).probe('a').x).toBeCloseTo(1.5, 9);
  });
});

describe('a jump seek ahead after a seek back, with no earlier jump', () => {
  it('plays a call recorded on the way', () => {
    const { t } = made();
    for (let at = 0; at <= 500; at += 50) t.sync(at);
    t.announce('mid', { score: 's' });
    for (let at = 550; at <= 1000; at += 50) t.sync(at);
    t.seek(0);
    t.seek(100);
    t.seek(550);
    expect(named(t)).toEqual(['mid']);
  });
});
