import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { transport } from '../src/transport.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const a = { id: 'a' };
// x reads the voice's own elapsed time, so where the mix stands shows in the pose.
const line = patch<{ id: string }, Pose>(10_000, (phase) => ({ x: phase * 10_000 }), {
  writes: ['x'],
});

function paused() {
  const m = mix<{ id: string }, Pose>(K, { name: 'paused', history: { ms: 1e6, tape } });
  m.sync(0);
  m.cue({ patch: line, loop: false });
  m.sync(100);
  m.rate = 0;
  m.sync(200);
  return m;
}

describe('a seek ahead the rate never carries the mix to', () => {
  it('jumps there while paused, and stays paused', () => {
    const m = paused();
    expect(m.probe(a).x).toBeCloseTo(100, 9);
    m.seek(600);
    expect(m.now).toBe(600);
    expect(m.rate).toBe(0);
    expect(m.probe(a).x).toBeCloseTo(600, 9);
    m.sync(300);
    expect(m.now).toBe(600);
    expect(m.probe(a).x).toBeCloseTo(600, 9);
  });

  it('jumps past where a ramp to rest stops, and runs out the rest of the ramp from there', () => {
    const m = mix<{ id: string }, Pose>(K, { name: 'slowing', history: { ms: 1e6, tape } });
    m.sync(0);
    m.cue({ patch: line, loop: false });
    m.sync(100);
    m.ramp(0, 100);
    m.sync(120);
    m.seek(500);
    expect(m.now).toBe(500);
    expect(m.probe(a).x).toBeCloseTo(500, 9);
    // 80 ms of the ramp were left, slowing from 0.8 to 0.
    m.sync(400);
    expect(m.now).toBeCloseTo(532, 9);
    expect(m.rate).toBe(0);
  });

  it('can be sought back from, to before the jump and into the time it passed over', () => {
    const m = paused();
    m.seek(600);
    m.sync(250);
    m.seek(400);
    expect(m.now).toBe(400);
    expect(m.rate).toBe(0);
    expect(m.probe(a).x).toBeCloseTo(400, 9);
    m.seek(50);
    expect(m.now).toBe(50);
    expect(m.rate).toBe(1);
    expect(m.probe(a).x).toBeCloseTo(50, 9);
    m.seek(700);
    expect(m.now).toBe(700);
    expect(m.rate).toBe(0);
    expect(m.probe(a).x).toBeCloseTo(700, 9);
  });

  it('moves a transport with no mix on it', () => {
    const t = transport({ history: { ms: 1e6, tape } });
    t.sync(0);
    t.sync(100);
    t.rate = 0;
    t.sync(200);
    t.seek(600);
    expect(t.now).toBe(600);
    t.rate = -1;
    t.sync(300);
    expect(t.now).toBe(500);
    t.seek(900);
    expect(t.now).toBe(900);
  });
});

describe('a seek to a time finer than host time can hold', () => {
  it.each([0, 1])(
    'stays there through a sync at the same timestamp after a rebase, at rate %s',
    (rate) => {
      const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape } });
      mix<{ id: string }, Pose>(K, { name: 'fine', transport: t });
      t.sync(0);
      if (rate !== 1) t.rate = rate;
      t.rebase();
      t.sync(0);
      t.seek(1e-300);
      t.sync(0);
      expect(t.now).toBe(1e-300);
      t.seek(5e-324);
      t.sync(0);
      expect(t.now).toBe(5e-324);
    },
  );
});

describe('a seek back to a time finer than host time can hold, under a clock at rest', () => {
  it('lands at a finite host time, so a later ramp reads a rate', () => {
    const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape } });
    mix<{ id: string }, Pose>(K, { name: 'fine', transport: t });
    t.sync(0);
    t.rebase();
    t.ramp(1, 0);
    t.ramp(0, 0);
    t.rebase();
    t.sync(0);
    t.rebase();
    t.sync(0);
    t.ramp(1, 0);
    t.seek(1e-323);
    t.ramp(0, 0);
    t.seek(5e-324);
    t.ramp(0, 0);
    t.ramp(1, 10);
    expect(t.rate).toBe(0);
    expect(t.now).toBe(5e-324);
  });
});

describe('a clock run past the largest number', () => {
  it('stops there, on a mix with nothing cued and on a transport', () => {
    const m = mix<{ id: string }, Pose>(K, { name: 'fast' });
    m.sync(0);
    m.rate = Number.MAX_VALUE;
    m.sync(16);
    expect(m.now).toBe(Number.MAX_VALUE);
    m.sync(32);
    expect(m.now).toBe(Number.MAX_VALUE);
    const t = transport();
    t.sync(0);
    t.rate = Number.MAX_VALUE;
    t.sync(16);
    expect(t.now).toBe(Number.MAX_VALUE);
  });
});

describe('a ramp to rest read across an infinite gap', () => {
  it('reads where the ramp stopped', () => {
    const m = mix<{ id: string }, Pose>(K, { name: 'resting' });
    m.sync(0);
    m.ramp(0, 100);
    expect(m.time(Number.POSITIVE_INFINITY)).toBe(50);
    const t = transport();
    t.sync(0);
    t.ramp(0, 100);
    expect(t.time(Number.POSITIVE_INFINITY)).toBe(50);
  });
});
