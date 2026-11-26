import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { transport } from '../src/transport.js';

// weasel's clock makes its transport this way: synced once at 0, then rebased.
function clock(history = true) {
  const t = transport(history ? { history: { ms: Number.POSITIVE_INFINITY, tape } } : {});
  t.sync(0);
  t.rebase();
  return t;
}

describe('a transport kept as a clock', () => {
  it('runs back with no history and no mix, its clock alone', () => {
    const t = clock(false);
    t.sync(100);
    t.sync(200);
    t.rate = -1;
    t.sync(250);
    expect(t.now).toBe(50);
    t.rate = 1;
    t.sync(270);
    expect(t.now).toBe(70);
  });

  it('counts no time on a sync at the same timestamp after a drive starts and ends while a rebase is pending', () => {
    const t = clock();
    t.ramp(1, 0);
    t.ramp(-0.25, 0);
    t.ramp(1, 0);
    t.sync(1e7);
    expect(t.now).toBe(0);
    t.sync(1e7);
    expect(t.now).toBe(0);
    t.sync(1e7 + 16);
    expect(t.now).toBe(16);
  });

  it('undoes a jump ahead when sought back to the frame it was made in', () => {
    const t = clock();
    t.ramp(0, 0);
    t.seek(10);
    t.seek(0.001);
    t.ramp(0, 0);
    expect(t.now).toBe(0.001);
    t.sync(0);
    expect(t.now).toBe(0.001);
  });

  it('keeps a seek ahead finer than host time through a rebased sync', () => {
    const t = clock();
    t.ramp(0, 0);
    t.sync(0);
    t.ramp(4, 0);
    t.seek(5e-324);
    t.ramp(1, 0);
    t.rebase();
    t.sync(0);
    expect(t.now).toBe(5e-324);
  });
});
