import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { lax, pipe } from '../src/fit.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Mix } from '../src/types.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
interface Row {
  id: string;
}
type M = Mix<Row, Pose>;

/** Writes x as the phase, so a probe reads how far through its pass a voice is. */
const write = (ms: number) => patch<Row, Pose>(ms, (phase) => ({ x: phase }), { writes: ['x'] });

const ends = (m: M, name: string) =>
  m
    .marks(0, 100_000)
    .filter((e) => e.name === name && e.mark === 'end')
    .map((e) => Math.round(e.timestamp * 1000) / 1000);
const startOf = (m: M, name: string) =>
  m
    .marks(0, 100_000)
    .filter((e) => e.name === name && e.mark === 'start')
    .map((e) => Math.round(e.timestamp * 1000) / 1000);

describe('spans', () => {
  it('queues its children, a late one after the last', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'seq' });
    m.cue({ patch: write(300), loop: false, owner: s, name: 'a' });
    m.cue({ patch: write(200), loop: false, owner: s, name: 'b' });
    expect(startOf(m, 'b')).toEqual([300]);
    m.sync(100);
    m.cue({ patch: write(100), loop: false, owner: s, name: 'c' });
    expect(startOf(m, 'c')).toEqual([500]);
  });

  it("fits astv's phase: twelve changes into 2s, each allowed four times faster", () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const phase = m.span({ name: 'phase', duration: 2000 });
    for (let i = 0; i < 12; i++)
      m.cue({ patch: write(400), loop: false, owner: phase, name: `c${i}`, faster: 4 });
    expect(ends(m, 'c11')).toEqual([2000]);
    expect(ends(m, 'phase')).toEqual([2000]);
    expect(phase.result).toMatchObject({ budget: 2000, over: 0, skipped: 0, fell: false });
  });

  it('collapses children that cannot give way, by default, and the budget holds', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const phase = m.span({ name: 'phase', duration: 500 });
    m.cue({ patch: write(400), loop: false, owner: phase, name: 'a' });
    m.cue({ patch: write(400), loop: false, owner: phase, name: 'b' });
    expect(phase.result).toMatchObject({ skipped: 2, fell: true, over: 0 });
    expect(ends(m, 'phase')).toEqual([500]);
    m.sync(1);
    expect(m.probe({ id: 'r' }).x).toBe(0);
  });

  it('runs long instead under overrun, and says by how much', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const phase = m.span({ name: 'phase', duration: 500, spill: 'overrun' });
    m.cue({ patch: write(400), loop: false, owner: phase });
    m.cue({ patch: write(400), loop: false, owner: phase });
    expect(phase.result).toMatchObject({ over: 300, fell: true, skipped: 0 });
    expect(ends(m, 'phase')).toEqual([800]);
  });

  it('runs long without saying so where its budget is weak', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const phase = m.span({ duration: 500, priority: 'weak' });
    m.cue({ patch: write(400), loop: false, owner: phase });
    m.cue({ patch: write(400), loop: false, owner: phase });
    expect(phase.result).toMatchObject({ over: 300, fell: false });
  });

  it('fits late arrivals into what is left, speeding up the one playing without a jump', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const phase = m.span({ duration: 2000 });
    m.cue({ patch: write(1000), loop: false, owner: phase, name: 'a', faster: 4 });
    m.cue({ patch: write(1000), loop: false, owner: phase, name: 'b', faster: 4 });
    m.sync(500);
    const before = m.probe({ id: 'r' }).x;
    m.cue({ patch: write(1000), loop: false, owner: phase, name: 'c', faster: 4 });
    m.cue({ patch: write(1000), loop: false, owner: phase, name: 'd', faster: 4 });
    m.sync(500);
    expect(m.probe({ id: 'r' }).x).toBeCloseTo(before);
    // 3500 ms left of them into 1500: each 7/3 times as fast.
    expect(ends(m, 'a')[0]).toBeCloseTo(500 + 500 / (7 / 3));
    expect(ends(m, 'd')[0]).toBeCloseTo(2000);
  });

  it('gives the rest more room when a child leaves early', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const phase = m.span({ duration: 2000 });
    m.cue({ patch: write(1000), loop: false, owner: phase, name: 'a', faster: 4 });
    const b = m.cue({ patch: write(1000), loop: false, owner: phase, name: 'b', faster: 4 });
    m.cue({ patch: write(1000), loop: false, owner: phase, name: 'c', faster: 4 });
    m.cue({ patch: write(1000), loop: false, owner: phase, name: 'd', faster: 4 });
    expect(ends(m, 'a')).toEqual([500]);
    b.fade({ over: 0 });
    m.sync(0);
    expect(ends(m, 'a')[0]).toBeCloseTo(2000 / 3);
  });

  it('stays until its budget has passed, so a late child joins and an anchor waits for it', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const phase = m.span({ name: 'phase', duration: 1000 });
    m.cue({ patch: write(100), loop: false, owner: phase });
    m.cue({ patch: write(50), loop: false, name: 'next', anchor: { start: { after: 'phase' } } });
    m.sync(500);
    expect(phase.state).toBe('live');
    m.cue({ patch: write(100), loop: false, owner: phase, name: 'late' });
    expect(startOf(m, 'late')).toEqual([500]);
    expect(startOf(m, 'next')).toEqual([1000]);
    m.sync(1000);
    expect(phase.state).toBe('done');
  });

  it('fits a span held by a span through its own rate', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const outer = m.span({ name: 'outer', duration: 500, fit: pipe() });
    const inner = m.span({ owner: outer, order: 'together', faster: 2, name: 'inner' });
    m.cue({ patch: write(600), loop: false, owner: inner, name: 'a' });
    m.cue({ patch: write(400), loop: false, owner: outer, name: 'b', faster: 2 });
    expect(ends(m, 'b')[0]).toBeCloseTo(500);
    expect(ends(m, 'a')[0]).toBeCloseTo(300);
  });

  it('lets lenient overrun only once retiming is spent', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const phase = m.span({ duration: 500, fit: lax({ cap: 2 }), spill: 'overrun' });
    m.cue({ patch: write(1500), loop: false, owner: phase, faster: 2 });
    expect(phase.result.length).toBeCloseTo(750);
    expect(phase.result.fell).toBe(false);
  });

  it('refuses a child with a start of its own, one that never ends, and a plain owner', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({});
    expect(() => m.cue({ patch: write(100), owner: s, start: 50, loop: false })).toThrow(
      /no start of its own/,
    );
    expect(() => m.cue({ patch: write(100), owner: s })).toThrow(/never ends/);
    expect(() => m.owns({ owner: s })).toThrow(/not owners/);
  });

  it('seeks back through a late arrival and plays it again the same', () => {
    const opts = { history: { ms: 10_000, tape: tape } };
    const scene = (m: M, upTo: number) => {
      const phase = m.span({ name: 'phase', duration: 2000 });
      m.cue({ patch: write(1000), loop: false, owner: phase, name: 'a', faster: 4 });
      m.cue({ patch: write(1000), loop: false, owner: phase, name: 'b', faster: 4 });
      const probes: number[] = [];
      for (let t = 0; t <= upTo; t += 50) {
        m.sync(t);
        if (t === 500) {
          m.cue({ patch: write(1000), loop: false, owner: phase, name: 'c', faster: 4 });
          m.cue({ patch: write(1000), loop: false, owner: phase, name: 'd', faster: 4 });
        }
        probes.push(m.probe({ id: 'r' }).x);
      }
      return probes;
    };
    const live = mix<Row, Pose>(K, opts);
    live.sync(0);
    const straight = scene(live, 1500);
    const m = mix<Row, Pose>(K, opts);
    m.sync(0);
    scene(m, 1500);
    m.seek(300);
    // Marks are host time, which now reads 1200 ahead of the mix.
    expect(ends(m, 'a')).toEqual([2200]);
    const again: number[] = [];
    for (let t = 300; t <= 1500; t += 50) {
      m.sync(1500 + (t - 300));
      again.push(m.probe({ id: 'r' }).x);
    }
    expect(again.map((x) => x.toFixed(9))).toEqual(straight.slice(6).map((x) => x.toFixed(9)));
  });
});
