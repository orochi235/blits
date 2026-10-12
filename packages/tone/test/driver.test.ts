import { kit, mix, patch, sum } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it, vi } from 'vitest';
import type { Target } from '../src/index.js';
import { drive, Tone } from './audio.js';
import { onsets, render, sampleAt } from './render.js';
import { reference } from './scene.js';

interface Level {
  x: number;
}

/** A mix where each subject's `x` climbs 1 a ms from its own start: `a` from 0, `b` from 100. */
function climbing() {
  const m = mix<string, Level>(kit({ x: sum() }));
  const base = (s: string) => (s === 'b' ? 100 : 0);
  m.cue({
    patch: patch<string, Level>(1000, (p, s) => ({ x: base(s) + p * 1000 }), { writes: ['x'] }),
    start: 0,
  });
  return m;
}

/** A target that keeps what was scheduled on it, as a native `AudioParam` would take it. */
function recorder() {
  const ramps: { value: number; time: number }[] = [];
  const holds: number[] = [];
  const target: Target = {
    cancelAndHoldAtTime: (time) => holds.push(time),
    linearRampToValueAtTime: (value, time) => ramps.push({ value, time }),
  };
  return { target, ramps, holds };
}

describe('attach and write', () => {
  it('writes each subject its own values, a point a step from the clock to ahead', () => {
    const m = climbing();
    const d = drive(m, { clock: () => 2, ahead: 20, grid: 10 });
    const a = recorder();
    const b = recorder();
    d.attach('a', { x: a.target });
    d.attach('b', { x: b.target });
    m.sync(0);
    d.write();
    expect(a.holds).toEqual([2]);
    expect(a.ramps.map((r) => r.value)).toEqual([0, 10, 20]);
    expect(b.ramps.map((r) => r.value)).toEqual([100, 110, 120]);
    expect(a.ramps.map((r) => r.time)).toEqual([2, 2.01, 2.02]);
  });

  it('ends a grid that does not divide ahead on ahead itself', () => {
    const m = climbing();
    const d = drive(m, { clock: () => 0, ahead: 25, grid: 10 });
    const a = recorder();
    d.attach('a', { x: a.target });
    m.sync(0);
    d.write();
    expect(a.ramps.map((r) => r.value)).toEqual([0, 10, 20, 25]);
  });

  it('writes nothing before the first sync', () => {
    const d = drive(climbing(), { clock: () => 0 });
    const a = recorder();
    d.attach('a', { x: a.target });
    d.write();
    expect(a.holds).toEqual([]);
    expect(a.ramps).toEqual([]);
  });

  it('carries on from where the mix was after a rebase', () => {
    const m = climbing();
    let clock = 0;
    const d = drive(m, { clock: () => clock, ahead: 10, grid: 10 });
    const a = recorder();
    d.attach('a', { x: a.target });
    m.sync(100);
    d.write();
    m.rebase();
    clock = 5;
    m.sync(5100);
    d.write();
    expect(a.ramps.slice(2)).toEqual([
      { value: 100, time: 5 },
      { value: 110, time: 5.01 },
    ]);
  });

  it('leaves the targets holding when the mix cannot be read ahead', () => {
    const m = climbing();
    const d = drive(m, { clock: () => 0 });
    const a = recorder();
    d.attach('a', { x: a.target });
    m.sync(0);
    vi.spyOn(m, 'project').mockImplementation(() => {
      throw new Error('no reading ahead');
    });
    expect(() => d.write()).toThrow('no reading ahead');
    expect(a.holds).toEqual([0]);
    expect(a.ramps).toEqual([]);
  });

  it('refuses a subject attached twice', () => {
    const d = drive(climbing(), { clock: () => 0 });
    d.attach('a', {});
    expect(() => d.attach('a', {})).toThrow('attached already');
  });

  it.each([
    { ahead: -1 },
    { ahead: Number.NaN },
    { grid: 0 },
    { grid: Number.POSITIVE_INFINITY },
    { late: -1 },
  ])('refuses %o', (opts) => {
    expect(() => drive(climbing(), opts)).toThrow(RangeError);
  });

  it("reads Tone's clock when given none", async () => {
    const a = recorder();
    await Tone.Offline(
      () => {
        const m = climbing();
        const d = drive(m, { ahead: 10, grid: 10 });
        d.attach('a', { x: a.target });
        m.sync(700);
        d.write();
      },
      0.01,
      1,
      48000,
    );
    expect(a.ramps.map((r) => r.time)).toEqual([0, 0.01]);
  });
});

describe('take', () => {
  it('hands over the tagged voices only, at a time in seconds on the audio clock', () => {
    const m = mix<string, Level>(kit({ x: sum() }));
    const silent = patch<string, Level>(1000, () => ({}), { writes: [] });
    m.cue({ patch: silent, start: 0, hits: [{ at: 50, event: 'kept' }], tags: ['drums'] });
    m.cue({ patch: silent, start: 0, hits: [{ at: 60, event: 'left' }] });
    const played: [unknown, number][] = [];
    drive<string, Level, string>(m, {
      clock: () => 2,
      tag: 'drums',
      take: (item, time) => {
        if ('hit' in item) played.push([item.event, time]);
        return undefined;
      },
    });
    m.sync(0);
    expect(played).toEqual([['kept', 2.05]]);
  });
});

describe('detach and cancel', () => {
  it('holds a detached subject where it had got to', async () => {
    let at = Number.NaN;
    const r = await render({
      each: (f, driver) => {
        if (f < 1000 || !Number.isNaN(at)) return;
        driver.detach('tone');
        at = f;
      },
    });
    const held = r.freq[sampleAt(at + 1)] as number;
    expect(Math.abs(held - (reference([], [])[Math.round(at)]?.freq as number))).toBeLessThan(2);
    expect(r.freq[sampleAt(2500)]).toBe(held);
    expect(r.freq[sampleAt(3900)]).toBe(held);
  });

  it('cancels the notes booked ahead, and holds every subject', async () => {
    let at = Number.NaN;
    const r = await render({
      each: (f, driver) => {
        if (f < 1700 || !Number.isNaN(at)) return;
        driver.cancel();
        at = f;
      },
    });
    // Notes fall every 250 ms, so one at 1750 was booked, 150 ms ahead, when the driver stopped.
    expect(Math.max(...onsets(r.notes))).toBe(1500);
    expect(r.freq[sampleAt(3900)]).toBe(r.freq[sampleAt(at + 1)]);
  });
});

describe('scrubbing', () => {
  it('writes through a call the tape holds after a seek back', () => {
    const m = mix<string, Level>(kit({ x: sum() }), { history: { ms: 10_000, tape } });
    const step = patch<string, Level>(0, () => ({ x: 50 }), { writes: ['x'] });
    m.sync(0);
    m.sync(100);
    m.cue({ patch: step });
    m.sync(200);
    m.seek(90);
    const a = recorder();
    const d = drive(m, { clock: () => 0, ahead: 20, grid: 10 });
    d.attach('a', { x: a.target });
    // The host's clock runs on from the seek: 5 ms later the mix reads 95.
    m.sync(205);
    d.write();
    // The cue was made at 100, which the second point reaches.
    expect(a.ramps.map((r) => r.value)).toEqual([0, 50, 50]);
  });
});
