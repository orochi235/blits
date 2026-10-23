import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Mix, SpanSpec, VoiceSpec } from '../src/types.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
interface Row {
  id: string;
}
type M = Mix<Row, Pose>;

const write = (ms: number) => patch<Row, Pose>(ms, (phase) => ({ x: phase }), { writes: ['x'] });

const at = (m: M, name: string, mark: 'start' | 'end') =>
  m
    .marks(0, 100_000)
    .filter((e) => e.name === name && e.mark === mark)
    .map((e) => Math.round(e.timestamp * 1000) / 1000);

const ORB = { name: 'orb', score: 'orbs' } as const;

describe('a span child with an earliest start', () => {
  it('starts no sooner than a time on its span’s clock, and the queue follows it', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'phase' });
    m.cue({ patch: write(300), owner: s, name: 'a' });
    m.cue({ patch: write(200), owner: s, name: 'b', earliest: 500 });
    m.cue({ patch: write(100), owner: s, name: 'c' });
    expect(at(m, 'b', 'start')).toEqual([500]);
    expect(at(m, 'c', 'start')).toEqual([700]);
  });

  it('keeps its order’s start where that is later than its floor', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'phase' });
    m.cue({ patch: write(300), owner: s, name: 'a' });
    m.cue({ patch: write(200), owner: s, name: 'b', earliest: 100 });
    expect(at(m, 'b', 'start')).toEqual([300]);
  });

  it('waits on an anchor with no answer, with every child after it, then follows it', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'phase' });
    m.cue({ patch: write(300), owner: s, name: 'a' });
    m.cue({ patch: write(200), owner: s, name: 'b', earliest: { of: ORB, mark: 'end' } });
    m.cue({ patch: write(100), owner: s, name: 'c' });
    m.sync(100);
    expect(at(m, 'b', 'start')).toEqual([]);
    expect(at(m, 'c', 'start')).toEqual([]);
    m.cue({ patch: write(400), score: 'orbs', name: 'orb' });
    m.sync(116);
    expect(at(m, 'orb', 'end')).toEqual([500]);
    expect(at(m, 'b', 'start')).toEqual([500]);
    expect(at(m, 'c', 'start')).toEqual([700]);
    m.sync(750);
    expect(m.probe({ id: 'r' }).x).toBeCloseTo(0.5, 9);
  });

  it('waits alone under together', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'phase', order: 'together' });
    m.cue({ patch: write(200), owner: s, name: 'a', earliest: { of: ORB, mark: 'end' } });
    m.cue({ patch: write(200), owner: s, name: 'b' });
    expect(at(m, 'a', 'start')).toEqual([]);
    expect(at(m, 'b', 'start')).toEqual([0]);
  });

  it('starts partway through where its floor has passed, and the queue follows it', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'phase' });
    for (let t = 16; t <= 1008; t += 16) m.sync(t);
    m.cue({ patch: write(1000), owner: s, name: 'a', earliest: 608 });
    m.cue({ patch: write(100), owner: s, name: 'b', earliest: 0 });
    expect(at(m, 'a', 'start')).toEqual([608]);
    expect(at(m, 'b', 'start')).toEqual([1608]);
    m.sync(1024);
    expect(m.probe({ id: 'r' }).x).toBeCloseTo(0.416, 9);
  });

  it('waits on the one before it once cued, though its floor has passed since', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'phase' });
    m.cue({ patch: write(100), owner: s, name: 'a', earliest: 100 });
    m.cue({ patch: write(100), owner: s, name: 'b', earliest: 100 });
    for (let t = 50; t <= 250; t += 50) m.sync(t);
    expect(at(m, 'b', 'start')).toEqual([200]);
    expect(m.probe({ id: 'r' }).x).toBeCloseTo(0.5, 9);
  });

  it('starts before its span began where its floor says', () => {
    const m = mix<Row, Pose>(K);
    for (let t = 0; t <= 1008; t += 16) m.sync(t);
    const s = m.span({ name: 'phase' });
    m.cue({ patch: write(1000), owner: s, name: 'a', earliest: -400 });
    expect(at(m, 'a', 'start')).toEqual([608]);
    m.sync(1024);
    expect(m.probe({ id: 'r' }).x).toBeCloseTo(0.416, 9);
  });

  it('starts no sooner than now without a floor, after one placed in the past', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'phase', order: 'together' });
    for (let t = 16; t <= 1008; t += 16) m.sync(t);
    m.cue({ patch: write(1000), owner: s, name: 'a', earliest: 608 });
    m.cue({ patch: write(100), owner: s, name: 'b' });
    expect(at(m, 'b', 'start')).toEqual([1008]);
  });

  it('starts at once where its anchor passed before the span began', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: write(1000), score: 'orbs', name: 'orb' });
    for (let t = 16; t <= 304; t += 16) m.sync(t);
    const s = m.span({ name: 'phase' });
    m.cue({ patch: write(200), owner: s, name: 'a', earliest: { of: ORB, mark: 'start' } });
    expect(at(m, 'a', 'start')).toEqual([304]);
  });

  it('runs past the budget where its floor puts it, as the span’s spill says', () => {
    const cue = (spill: SpanSpec<Row>['spill']) => {
      const m = mix<Row, Pose>(K);
      m.sync(0);
      const s = m.span({ name: 'phase', duration: 500, spill, priority: 'strong' });
      m.cue({ patch: write(200), owner: s, name: 'a', earliest: 400 });
      return s.result;
    };
    expect(cue('overrun')).toMatchObject({ over: 100, skipped: 0 });
    expect(cue('instant')).toMatchObject({ skipped: 1, fell: true });
  });
});

describe('a span child’s rank', () => {
  it('lays out the children still to start by rank, ties as cued', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'phase' });
    m.cue({ patch: write(100), owner: s, name: 'c', rank: 3 });
    m.cue({ patch: write(100), owner: s, name: 'a', rank: 1 });
    m.cue({ patch: write(100), owner: s, name: 'b1', rank: 2 });
    m.cue({ patch: write(100), owner: s, name: 'b2', rank: 2 });
    expect(['a', 'b1', 'b2', 'c'].map((n) => at(m, n, 'start')[0])).toEqual([0, 100, 200, 300]);
  });

  it('never goes ahead of a child already playing', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const s = m.span({ name: 'phase' });
    m.cue({ patch: write(300), owner: s, name: 'x', rank: 5 });
    m.cue({ patch: write(100), owner: s, name: 'z', rank: 9 });
    m.sync(100);
    m.cue({ patch: write(100), owner: s, name: 'y', rank: 0 });
    expect(at(m, 'x', 'start')).toEqual([0]);
    expect(at(m, 'y', 'start')).toEqual([300]);
    expect(at(m, 'z', 'start')).toEqual([400]);
  });
});

/** astv's `scheduleMarks`, which a span child's `earliest` and `rank` replace. */
function scheduleMarks(
  marks: { line: number; at: number; run: number }[],
  order: 'queue' | 'stagger',
  share: number,
): Map<number, number> {
  const out = new Map<number, number>();
  let next = Number.NEGATIVE_INFINITY;
  for (const m of [...marks].sort((a, b) => a.line - b.line)) {
    const start = Math.max(m.at, next);
    out.set(m.line, start);
    next = start + m.run * (order === 'queue' ? 1 : share);
  }
  return out;
}

describe("astv's change order on a span", () => {
  for (const order of ['queue', 'stagger'] as const)
    for (const late of [false, true])
      it(`starts each change where scheduleMarks would, under ${order}${late ? ', cued late' : ''}`, () => {
        let seed = 7;
        const rand = () => {
          seed = (seed * 16807) % 2147483647;
          return seed / 2147483647;
        };
        const marks = Array.from({ length: 12 }, (_, i) => ({
          line: i * 3,
          at: Math.round(rand() * 2000),
          run: 100 + Math.round(rand() * 400),
        }));
        // Arriving in an order other than by line.
        const arrival = [...marks].sort((a, b) => a.at - b.at);
        const m = mix<Row, Pose>(K);
        m.sync(0);
        const s = m.span({ name: 'phase', order, share: 0.5 });
        // Cued late, as a host that made its mix afresh after a seek does: some have landed.
        if (late) for (let t = 16; t <= 1200; t += 16) m.sync(t);
        for (const k of arrival) {
          const spec: VoiceSpec<Row, Pose> = {
            patch: write(k.run),
            owner: s,
            name: `line ${k.line}`,
            rank: k.line,
            earliest: k.at,
          };
          m.cue(spec);
        }
        const want = scheduleMarks(marks, order, 0.5);
        for (const k of marks) expect(at(m, `line ${k.line}`, 'start')).toEqual([want.get(k.line)]);
      });
});

describe('an anchored earliest across a seek', () => {
  it('plays the same after seeking back past where its anchor answered', () => {
    const opts = { history: { ms: 10_000, tape } };
    const scene = (m: M, upTo: number) => {
      const s = m.span({ name: 'phase' });
      m.cue({ patch: write(300), owner: s, name: 'a' });
      m.cue({ patch: write(200), owner: s, name: 'b', earliest: { of: ORB, mark: 'end' } });
      const probes: number[] = [];
      for (let t = 0; t <= upTo; t += 50) {
        m.sync(t);
        if (t === 100) m.cue({ patch: write(400), score: 'orbs', name: 'orb' });
        probes.push(m.probe({ id: 'r' }).x);
      }
      return probes;
    };
    const live = mix<Row, Pose>(K, opts);
    live.sync(0);
    const straight = scene(live, 900);
    const m = mix<Row, Pose>(K, opts);
    m.sync(0);
    scene(m, 900);
    m.seek(50);
    const again: number[] = [];
    for (let t = 50; t <= 900; t += 50) {
      m.sync(900 + (t - 50));
      again.push(m.probe({ id: 'r' }).x);
    }
    expect(again.map((x) => x.toFixed(9))).toEqual(straight.slice(1).map((x) => x.toFixed(9)));
  });
});
