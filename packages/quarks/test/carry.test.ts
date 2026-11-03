import { kit, mix } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);
const a: Spot = { id: 'a' };

/** A double as an exact fraction over 2^80, which holds every number these tests use. */
const exact = (x: number): bigint => BigInt(x * 2 ** 80);

/**
 * Runs `frames` frames `dt` ms apart at a constant `rate`, and counts the frames whose running total
 * differs from the whole particles owed for the mix time since the first write, worked exactly.
 */
function drift(rate: number, dt: number, frames: number, offset = 0) {
  const m = mix<Spot, Emission>(K);
  const s = system();
  m.cue({ patch: hold({ rate }), subjects: [a] });
  const q = drive(m, { kit: K });
  q.attach(a, s, { at: [0, 0, 0] });
  m.sync(offset);
  q.write();
  const start = exact(m.now);
  const r = exact(rate);
  let early = 0;
  let late = 0;
  for (let f = 1; f <= frames; f++) {
    m.sync(offset + f * dt);
    q.write();
    const owed = Number((r * (exact(m.now) - start)) / (1000n * 2n ** 160n));
    if (s.particleNum > owed) early++;
    if (s.particleNum < owed) late++;
  }
  return { early, late, total: s.particleNum };
}

describe('the carry', () => {
  it('emits on the frame an exact accumulator does, at 60 fps and 4 a second', () => {
    expect(drift(4, 1000 / 60, 1200)).toEqual({ early: 0, late: 0, total: 80 });
  });

  it('emits on the frame an exact accumulator does, at 144 fps and 7 a second', () => {
    expect(drift(7, 1000 / 144, 1440)).toEqual({ early: 0, late: 0, total: 70 });
  });

  it('stays exact at fractional rates, odd frame times, and a clock far from 0', () => {
    expect(drift(2.5, 16, 1000)).toEqual({ early: 0, late: 0, total: 40 });
    expect(drift(0.1, 1000 / 59.94, 6000, 3_600_000)).toMatchObject({ early: 0, late: 0 });
    expect(drift(13.75, 1000 / 75, 3000, 12_345.678)).toMatchObject({ early: 0, late: 0 });
  });

  it('owes nothing for a hair under a whole particle', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 1 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    m.sync(0);
    q.write();
    m.sync(1000 - 5e-7);
    q.write();
    expect(s.particleNum).toBe(0);
    m.sync(1000);
    q.write();
    expect(s.particleNum).toBe(1);
  });
});
