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

  it('keeps every child skipped at cue skipped as they leave', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'seq', duration: 1500 });
    m.cue({ patch: write(1000), loop: false, owner: s, name: 'a' });
    m.cue({ patch: write(1000), loop: false, owner: s, name: 'b' });
    m.cue({ patch: write(1000), loop: false, owner: s, name: 'c', faster: 2 });
    expect(s.result).toMatchObject({ skipped: 3, fell: true });
    const read = [16, 500, 1000].map((t) => {
      m.sync(t);
      return m.probe({ id: 'r' }).x;
    });
    expect(read).toEqual([0, 0, 0]);
    expect(s.result).toMatchObject({ skipped: 3, fell: true });
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

  it('plays children shorter than a frame, each from where the one before it ended', () => {
    const build = () => {
      const m = mix<Row, Pose>(K);
      m.sync(0);
      const s = m.span({ duration: 2000 });
      for (let i = 0; i < 200; i++) m.cue({ patch: write(10), loop: false, owner: s });
      return { m, s };
    };
    const { m, s } = build();
    const ahead = build().m;
    for (let t = 16; t < 2000; t += 16) {
      m.sync(t);
      expect(m.probe({ id: 'r' }).x, `at ${t}`).toBeCloseTo((t % 10) / 10);
      expect(m.probe({ id: 'r' }).x, `ahead to ${t}`).toBe(ahead.project(t).probe({ id: 'r' }).x);
    }
    expect(s.result).toMatchObject({ skipped: 0, fell: false });
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

  it('under history, leaves at its budget with the children it keeps quiet', () => {
    const m = mix<Row, Pose>(K, { history: { ms: 10_000 } });
    m.sync(0);
    const phase = m.span({ name: 'phase', duration: 1000 });
    const child = m.cue({ patch: write(100), loop: false, owner: phase });
    m.sync(500);
    expect([child.state, phase.state]).toEqual(['live', 'live']);
    m.sync(1000);
    expect([child.state, phase.state]).toEqual(['done', 'done']);
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
    expect(() => m.cue({ patch: write(100), owner: s, loop: true })).toThrow(/never ends/);
    expect(() => m.owns({ owner: s })).toThrow(/not owners/);
  });

  it('refuses a rate below 0 at its cue, and takes one on its handle once it plays', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    expect(() => m.span({ rate: -1, seek: 500, duration: 500 })).toThrow(/backward/);
    const s = m.span({ duration: 500 });
    const c = m.cue({ patch: write(100), owner: s, loop: false });
    m.sync(50);
    s.rate = -1;
    m.sync(120);
    expect(c.state).toBe('done');
  });

  it('refuses a child cued at a rate below 0, which its handle turns once it plays', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'seq' });
    expect(() => m.cue({ patch: write(300), owner: s, loop: false, rate: -1 })).toThrow(
      /backward/,
    );
    expect(() => m.blend([write(300)], () => 1, { owner: s, loop: false, rate: -1 })).toThrow(
      /backward/,
    );
    const c = m.cue({ patch: write(300), owner: s, loop: false });
    m.sync(100);
    c.rate = -1;
    m.sync(150);
    expect(c.state).toBe('live');
    expect(c.elapsed).toBe(50);
  });

  it('cued with a seek, starts that far into its budget', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ duration: 500, seek: 200 });
    const c = m.cue({ patch: write(100), owner: s, loop: false });
    const at = (id: number, mark: string) =>
      m.marks(0, 2000).find((k) => k.voice === id && k.mark === mark)?.timestamp;
    expect(at(c.id, 'start')).toBe(0);
    expect(at(s.id, 'coast')).toBe(300);
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

describe.each([true, false])('a span’s played, lanes %s', (lanes) => {
  const tick = () => new Promise((res) => setTimeout(res, 0));
  const coast = (m: M, id: number) =>
    m.marks(0, 100_000).find((k) => k.voice === id && k.mark === 'coast')?.timestamp;

  it('resolves where its budget ends, its coast, not where its first child does', async () => {
    const m = mix<Row, Pose>(K, { lanes });
    m.sync(0);
    const s = m.span({ duration: 1000 });
    m.cue({ patch: write(100), loop: false, owner: s });
    let at: number | undefined;
    void s.played.then(() => {
      at = m.now;
    });
    for (let t = 50; t <= 1200; t += 50) {
      m.sync(t);
      await tick();
      if (t === 500) expect(coast(m, s.id)).toBe(1000);
    }
    expect(at).toBe(1000);
  });

  it('settles false when a child joins late and is faded before its passes end', async () => {
    const m = mix<Row, Pose>(K, { lanes });
    m.sync(0);
    const s = m.span({ duration: 1000 });
    m.cue({ patch: write(100), loop: false, owner: s });
    m.sync(200);
    const late = m.cue({ patch: write(300), loop: false, owner: s });
    m.sync(250);
    late.fade({ over: 0 });
    expect(await late.played).toBe(false);
    m.sync(1100);
    expect(await s.played).toBe(false);
  });

  for (const history of [false, true])
    it(`settles true when faded before its coast after every child it held played (history ${history})`, async () => {
      const m = mix<Row, Pose>(K, { lanes, ...(history ? { history: { ms: 10_000, tape } } : {}) });
      m.sync(0);
      const s = m.span({ duration: 1000 });
      m.cue({ patch: write(100), loop: false, owner: s });
      for (let t = 50; t <= 500; t += 50) m.sync(t);
      s.fade({ over: 0 });
      for (let t = 550; t <= 1200; t += 50) m.sync(t);
      expect(await s.played).toBe(true);
    });

  it('settles once, again after a seek back past it', async () => {
    const m = mix<Row, Pose>(K, { lanes, history: { ms: 10_000, tape } });
    m.sync(0);
    const s = m.span({ duration: 500 });
    m.cue({ patch: write(100), loop: false, owner: s });
    for (let t = 50; t <= 600; t += 50) m.sync(t);
    expect(await s.played).toBe(true);
    m.seek(300);
    let n = 0;
    let got: boolean | undefined;
    void s.played.then((p) => {
      n++;
      got = p;
    });
    await tick();
    expect(n).toBe(0);
    for (let t = 650; t <= 900; t += 50) m.sync(t);
    await tick();
    expect([n, got]).toEqual([1, true]);
  });
});

describe('a child cued into a span mid-frame', () => {
  const rise = (ms: number) =>
    patch<Row, Pose>(ms, (phase) => ({ x: 1 + phase }), { writes: ['x'] });
  for (const lanes of [true, false])
    for (const skip of [false, true])
      it(`shows in its cue frame, as a plain voice does, and a seek or read back agrees${skip ? ', one the fit skips' : ''}${lanes ? '' : ', without lanes'}`, () => {
        const m = mix<Row, Pose>(K, { lanes, history: { ms: 1e6, every: 50, tape }, stepMs: 4 });
        const r = { id: 'r' };
        let span: ReturnType<M['span']> | undefined;
        const shown: { seq: number; x: number }[] = [];
        for (const t of [0, 16, 176, 192, 208]) {
          m.sync(t);
          if (t === 0) span = m.span({ duration: 600, order: 'together' });
          // 1000 ms where 424 are left skips it, which puts it at its end, as a cue there does.
          if (t === 176) m.cue({ patch: rise(skip ? 500 : 100), owner: span, loop: skip ? 2 : 1 });
          shown.push({ seq: m.seq, x: m.probe(r).x });
        }
        expect(shown[2]?.x).toBe(skip ? 2 : 1);
        for (const s of shown) expect(m.project({ frame: s.seq }).probe(r).x).toBe(s.x);
        for (const s of shown.slice(1, -1).reverse()) {
          m.seek({ frame: s.seq });
          expect(m.probe(r).x).toBe(s.x);
        }
      });

  it('waits again where a later cue in the frame ranks ahead of it in the sequence', () => {
    const m = mix<Row, Pose>(K, { history: { ms: 1e6, every: 50, tape } });
    const r = { id: 'r' };
    m.sync(0);
    m.sync(16);
    const span = m.span({ duration: 1000 });
    m.cue({ patch: rise(100), owner: span, rank: 1, name: 'second' });
    expect(m.probe(r).x).toBe(1);
    const tens = patch<Row, Pose>(100, (phase) => ({ x: 10 + phase }), { writes: ['x'] });
    m.cue({ patch: tens, owner: span, rank: 0, name: 'first' });
    const seq = m.seq;
    expect(m.probe(r).x).toBe(10);
    expect(m.project({ frame: seq }).probe(r).x).toBe(10);
    m.sync(32);
    expect(m.probe(r).x).toBe(10.16);
    expect(startOf(m, 'second')).toEqual([116]);
  });
});
