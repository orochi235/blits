import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, mix, sum, transport } from '../src/index.js';

const K = kit({ x: sum() });

describe('mix.played', () => {
  it('counts what each sync moved the clock on, at the rate', () => {
    const m = mix<object, { x: number }>(K);
    m.sync(1000);
    expect(m.played).toBe(0);
    m.sync(1100);
    m.rate = 0.5;
    m.sync(1300);
    m.rate = 0;
    m.sync(1500);
    expect(m.played).toBe(200);
  });

  it('caps each sync at maxDt', () => {
    const m = mix<object, { x: number }>(K, { maxDt: 50 });
    m.sync(1000);
    m.sync(1020);
    m.sync(3020);
    expect(m.played).toBe(70);
  });

  it('adds nothing for a rebase or a seek, and counts from the time sought', () => {
    const m = mix<object, { x: number }>(K, { history: { ms: 10_000, tape } });
    m.sync(1000);
    m.sync(1100);
    m.rebase();
    m.sync(5000);
    expect(m.played).toBe(100);
    m.seek(m.now - 80);
    expect(m.played).toBe(100);
    m.sync(5030);
    expect(m.played).toBe(130);
    m.seek(m.now + 500);
    m.sync(5040);
    expect(m.played).toBe(140);
  });

  it('counts for every mix on a transport, each by its own maxDt', () => {
    const t = transport();
    const a = mix<object, { x: number }>(K, { transport: t, name: 'a' });
    const b = mix<object, { x: number }>(K, { transport: t, name: 'b', maxDt: 30 });
    t.sync(1000);
    t.sync(1100);
    expect([a.played, b.played]).toEqual([100, 30]);
  });
});
