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
const line = patch<{ id: string }, Pose>(1000, (phase) => ({ x: phase * 100 }), { writes: ['x'] });

function scrubbed() {
  const t = transport({ history: { ms: Number.POSITIVE_INFINITY, tape } });
  const m = mix<{ id: string }, Pose>(K, { name: 'scrubbed', transport: t });
  t.sync(0);
  t.sync(500);
  m.cue({ patch: line, loop: false });
  t.sync(800);
  t.seek(200);
  return { t, m };
}

describe('a rate call after a seek back', () => {
  it('leaves the calls recorded ahead on the tape, so a seek ahead plays them again', () => {
    const { t, m } = scrubbed();
    t.rate = 1;
    t.seek(700);
    expect(m.probe(a).x).toBeCloseTo(20, 9);
  });

  it('plays the recorded calls on at the rate it sets, and keeps that rate once they run out', () => {
    const { t, m } = scrubbed();
    t.rate = 2;
    expect(t.rate).toBe(2);
    // Mix time 200 to 600 at rate 2 takes 200 host ms; the cue recorded at 500 plays on the way.
    t.sync(1000);
    expect(t.now).toBeCloseTo(600, 9);
    expect(m.probe(a).x).toBeCloseTo(10, 9);
    t.sync(1200);
    expect(t.now).toBeCloseTo(1000, 9);
    expect(t.rate).toBe(2);
  });

  it('keeps the rate it set across a later seek', () => {
    const { t } = scrubbed();
    t.rate = 0.5;
    t.seek(300);
    expect(t.rate).toBe(0.5);
  });

  it('still branches the tape when it is a cue, not a rate', () => {
    const { t, m } = scrubbed();
    m.cue({ patch: line, loop: false });
    t.seek(700);
    expect(m.probe(a).x).toBeCloseTo(50, 9);
  });
});
