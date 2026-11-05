import { kit, mix } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);
const a: Spot = { id: 'a' };

interface Run {
  rate: number;
  dt: number;
  frames: number;
  offset?: number;
  maxDt?: number;
  /** Frames that take this many ms more than `dt`. */
  long?: { every: number; by: number };
}

/** The timestamps a run syncs at, the first of them written before any frame owes anything. */
function stamps({ dt, frames, offset = 0, long }: Run): number[] {
  const out = [offset];
  let t = offset;
  for (let f = 1; f <= frames; f++) {
    t += dt;
    if (long !== undefined && f % long.every === 0) t += long.by;
    out.push(t);
  }
  return out;
}

/** The particles each frame emits under a host's own loop: a float carry of rate × seconds. */
function byHand(run: Run): number[] {
  const t = stamps(run);
  const out: number[] = [];
  let carry = 0;
  for (let f = 1; f < t.length; f++) {
    const gap = (t[f] as number) - (t[f - 1] as number);
    const ms = run.maxDt !== undefined && gap > run.maxDt ? run.maxDt : gap;
    carry += run.rate * (ms / 1000);
    const n = Math.floor(carry);
    carry -= n;
    out.push(n);
  }
  return out;
}

/** The particles each frame emits through the driver's `rate`, under `carry: 'float'`. */
function driven(run: Run): number[] {
  const m = mix<Spot, Emission>(K, { maxDt: run.maxDt });
  const s = system();
  m.cue({ patch: hold({ rate: run.rate }), subjects: [a] });
  const q = drive(m, { kit: K, carry: 'float' });
  q.attach(a, s, { at: [0, 0, 0] });
  const out: number[] = [];
  for (const [f, t] of stamps(run).entries()) {
    m.sync(t);
    q.write();
    if (f > 0) out.push(q.emitted.get(a) ?? 0);
  }
  return out;
}

describe("carry: 'float'", () => {
  it('emits on the frames a host summing rate × seconds does, where exact arithmetic would not', () => {
    // At 3 a second the 20th frame owes exactly one particle; the host's float sum comes a hair
    // short and emits it on the 21st.
    const run = { rate: 3, dt: 1000 / 60, frames: 3000, maxDt: 50, long: { every: 900, by: 120 } };
    expect(driven(run)).toEqual(byHand(run));
  });

  it('does so at other rates and frame times, and on a clock far from 0', () => {
    for (const run of [
      { rate: 7, dt: 1000 / 144, frames: 1440 },
      { rate: 2.5, dt: 16, frames: 1000 },
      { rate: 0.1, dt: 1000 / 59.94, frames: 6000, offset: 3_600_000 },
      { rate: 13.75, dt: 1000 / 75, frames: 3000, offset: 12_345.678 },
      { rate: 4, dt: 1000 / 60, frames: 1200 },
      { rate: 10, dt: 1000 / 60, frames: 3000, long: { every: 900, by: 120 } },
    ])
      expect(driven(run)).toEqual(byHand(run));
  });

  it('counts a long frame for no more than maxDt, as a host clamping its step does', () => {
    const run = { rate: 4, dt: 1000 / 60, frames: 3000, maxDt: 50, long: { every: 97, by: 120 } };
    expect(driven(run)).toEqual(byHand(run));
  });

  it('owes nothing for a hair under a whole particle', () => {
    const run = { rate: 1, dt: 1000 - 5e-7, frames: 1 };
    expect(driven(run)).toEqual([0]);
  });
});
