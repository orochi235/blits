import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, last, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { transport } from '../src/transport.js';
import type { Marked, TransportOptions } from '../src/types.js';
import { memoryStore } from './store.js';

// Two kits that never fold together, as astv's flights and text runs.
interface Flight {
  u: number;
}
interface Row {
  chars: number;
}
const FLIGHT = kit<Flight>({ u: last<number>() });
const ROWS = kit<Row>({ chars: sum() });

const fly = (ms: number) => patch<string, Flight>(ms, (phase) => ({ u: phase }), { writes: ['u'] });
const type = (ms: number) =>
  patch<string, Row>(ms, (phase) => ({ chars: Math.round(phase * 10) }), { writes: ['chars'] });

const starts = (t: { marks(from: number, to: number): Marked[] }, name: string) =>
  t
    .marks(0, 100_000)
    .filter((e) => e.name === name && e.mark === 'start')
    .map((e) => e.timestamp);

const stage = (history?: TransportOptions['history']) => {
  const t = transport({ history });
  const orbs = mix<string, Flight>(FLIGHT, { transport: t, name: 'orbs' });
  const runs = mix<string, Row>(ROWS, { transport: t, name: 'runs' });
  return { t, orbs, runs };
};

describe('transport', () => {
  it('moves every mix on it with one sync and one rate', () => {
    const { t, orbs, runs } = stage();
    orbs.cue({ patch: fly(400), subjects: ['f'], loop: false });
    runs.cue({ patch: type(400), subjects: ['r'], loop: false });
    t.sync(0);
    t.rate = 0.5;
    t.sync(400);
    expect(orbs.now).toBe(200);
    expect(runs.now).toBe(200);
    expect(orbs.probe('f').u).toBeCloseTo(0.5, 9);
    expect(runs.probe('r').chars).toBe(5);
  });

  it('throws when a mix on it is moved by itself', () => {
    const { orbs } = stage();
    expect(() => orbs.sync(0)).toThrow(/transport/);
    expect(() => orbs.rebase()).toThrow(/transport/);
    expect(() => orbs.ramp(1, 0)).toThrow(/transport/);
    expect(() => {
      orbs.rate = 0.5;
    }).toThrow(/transport/);
    expect(() => orbs.seek(0)).toThrow(/transport/);
    const t = transport();
    expect(() => mix(FLIGHT, { transport: t, history: { ms: 100 } })).toThrow(/history/);
  });

  it('lets an anchor wait on a voice in another mix through a named score', () => {
    const { t, orbs, runs } = stage();
    t.sync(0);
    orbs.cue({ patch: fly(300), name: 'f12', score: 'step:12', tags: ['motion'], loop: false });
    runs.cue({
      patch: type(200),
      name: 'r12',
      score: 'step:12',
      tags: ['motion'],
      loop: false,
      anchor: { start: { after: { score: 'step:12', name: 'f12' } } },
    });
    t.sync(10);
    expect(starts(runs, 'r12')).toEqual([300]);
  });

  it('keeps a bare name inside its own mix', () => {
    const { t, orbs, runs } = stage();
    t.sync(0);
    orbs.cue({ patch: fly(300), name: 'line', loop: false });
    runs.cue({
      patch: type(200),
      name: 'caret',
      loop: false,
      anchor: { start: { after: 'line' } },
    });
    t.sync(10);
    expect(starts(runs, 'caret')).toEqual([]);
    runs.cue({ patch: type(500), name: 'line', loop: false });
    t.sync(20);
    expect(starts(runs, 'caret')).toEqual([510]);
  });

  it("waits on a step's motion across mixes and an announced mark, as astv's rail does", () => {
    const { t, orbs, runs } = stage();
    const rail = mix<string, Row>(ROWS, { transport: t, name: 'rail' });
    t.sync(0);
    rail.cue({ patch: type(1000), name: 'hold', score: 'step:12', loop: false });
    orbs.cue({ patch: fly(600), score: 'step:12', tags: ['motion'], loop: false });
    rail.cue({
      patch: type(100),
      name: 'step13',
      score: 'step:13',
      loop: false,
      anchor: {
        start: {
          all: [
            { after: { score: 'step:12', name: 'hold' } },
            {
              of: { score: 'step:12', tag: 'motion', resolver: 'latest' },
              mark: 'coast',
              by: 200,
            },
            { with: { score: 'step:12', name: 'built' } },
          ],
        },
      },
    });
    t.sync(100);
    // A text run lands late in the step and freezes on its last frame.
    runs.cue({
      patch: type(1200),
      score: 'step:12',
      tags: ['motion'],
      loop: false,
      freeze: 'both',
      start: 100,
    });
    t.sync(200);
    expect(starts(t, 'step13')).toEqual([]);
    t.announce('built', { score: 'step:12', at: 500 });
    t.sync(300);
    expect(starts(t, 'step13')).toEqual([1500]);
  });

  it.each([
    ['under history', true],
    ['without history', false],
  ])(
    'answers an anchor on a score as a read of every voice would, as voices come, change and go, %s',
    (_, kept) => {
      const resolvers = ['earliest', 'latest', 'first', 'last'] as const;
      const marks = ['start', 'coast', 'end'] as const;
      const { t, orbs, runs } = stage(kept ? { ms: 2000, tape } : undefined);
      t.sync(0);
      // Each waits pending for good, its start the anchor's answer moved far ahead.
      const BY = 1_000_000;
      for (const resolver of resolvers)
        for (const mark of marks)
          runs.cue({
            patch: type(100),
            name: `${resolver} ${mark}`,
            loop: false,
            anchor: { start: { of: { score: 's', tag: 'motion', resolver }, mark, by: BY } },
          });
      const expected = (resolver: (typeof resolvers)[number], mark: (typeof marks)[number]) => {
        const all = t
          .marks(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)
          .filter((e) => e.score === 's' && e.tags.includes('motion') && e.mark === mark);
        if (all.length === 0) return undefined;
        const by = (f: (a: Marked, b: Marked) => number) => (all.sort(f)[0] as Marked).timestamp;
        const at =
          resolver === 'earliest'
            ? by((a, b) => a.timestamp - b.timestamp)
            : resolver === 'latest'
              ? by((a, b) => b.timestamp - a.timestamp)
              : resolver === 'first'
                ? by((a, b) => (a.voice as number) - (b.voice as number))
                : by((a, b) => (b.voice as number) - (a.voice as number));
        return at + BY;
      };
      const placed = (name: string) =>
        t
          .marks(BY, Number.POSITIVE_INFINITY)
          .filter((e) => e.name === name && e.mark === 'start')
          .map((e) => e.timestamp);
      const check = () => {
        for (const resolver of resolvers)
          for (const mark of marks) {
            // A voice faded before its last pass never coasts, which `first` and `last` answer as
            // unknown, and a list of marks cannot show.
            if (mark === 'coast' && (resolver === 'first' || resolver === 'last')) continue;
            const want = expected(resolver, mark);
            if (want !== undefined)
              expect([resolver, mark, placed(`${resolver} ${mark}`)]).toEqual([
                resolver,
                mark,
                [want],
              ]);
          }
      };
      const next = (() => {
        let s = 7;
        return () => {
          s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
          return s / 2 ** 32;
        };
      })();
      let now = 0;
      const live: ReturnType<typeof orbs.cue>[] = [];
      const run = (frames: number) => {
        for (let f = 0; f < frames; f++) {
          now += 16;
          // Some long, some short, so the one that finishes last is often not the last cued.
          if (f % 5 === 0)
            live.push(
              orbs.cue({
                patch: fly(50 + Math.floor(next() * 900)),
                score: 's',
                tags: ['motion'],
                loop: false,
                // Retired frames after its fade begins, not in the same sync.
                fade: { out: 120 },
              }),
            );
          // The host retimes or fades one in flight now and then, which moves its marks.
          if (f % 5 === 2 && live.length > 0) {
            const h = live[Math.floor(next() * live.length)];
            if (next() < 0.5) h?.ramp(0.5 + next(), 100);
            else h?.fade({ over: 50 });
          }
          if (f % 7 === 0)
            orbs.cue({ patch: fly(100), score: 'other', tags: ['motion'], loop: false });
          t.sync(now);
          // A retime reaches the anchors waiting on it at the next sync.
          if (f % 10 === 0 || f % 5 === 3) check();
        }
      };
      run(400);
      if (!kept) return;
      t.seek(now - 1200);
      check();
      run(200);
    },
  );

  it('lists every mix and every announced mark, each naming its mix', () => {
    const { t, orbs, runs } = stage();
    t.sync(0);
    orbs.cue({ patch: fly(300), name: 'f', loop: false });
    runs.cue({ patch: type(300), name: 'r', loop: false, start: 100 });
    runs.announce('local', { at: 50 });
    t.announce('shared', { score: 's', at: 60 });
    const marks = t.marks(0, 10_000);
    expect(marks.filter((m) => m.mark === 'start').map((m) => [m.name, m.mix])).toEqual([
      ['f', 'orbs'],
      ['r', 'runs'],
    ]);
    expect(marks.filter((m) => m.mark === undefined).map((m) => [m.name, m.mix])).toEqual([
      ['local', 'runs'],
      ['shared', undefined],
    ]);
    // A mix sees announcements on named scores and on its own unnamed one.
    expect(
      orbs
        .marks(0, 10_000)
        .filter((m) => m.mark === undefined)
        .map((m) => m.name),
    ).toEqual(['shared']);
    expect(() => t.announce('x', {} as { score: string })).toThrow(/named score/);
  });

  it('reads ahead across mixes, so an anchor on another mix answers in a projection', () => {
    const { t, orbs, runs } = stage();
    t.sync(0);
    orbs.cue({ patch: fly(300), name: 'f', score: 's', subjects: ['f'], loop: false });
    runs.cue({
      patch: type(200),
      subjects: ['r'],
      loop: false,
      freeze: 'after',
      anchor: { start: { after: { score: 's', name: 'f' } } },
    });
    const p = t.project(400);
    expect(p.of(runs).probe('r').chars).toBe(5);
    expect(runs.project(400).probe('r').chars).toBe(5);
    expect(p.of(orbs).probe('f').u).toBeUndefined();
  });

  it('is inert only when every mix is, and wakes on a cue in any', () => {
    const { t, orbs, runs } = stage();
    t.sync(0);
    let woke = 0;
    t.onWake(() => {
      woke++;
    });
    orbs.cue({ patch: fly(100), subjects: ['f'], loop: false });
    expect(woke).toBe(1);
    runs.cue({ patch: type(100), subjects: ['r'], loop: false });
    expect(woke).toBe(1);
    t.sync(16);
    expect(t.inert).toBe(false);
    t.sync(500);
    expect(t.inert).toBe(true);
    runs.cue({ patch: type(100), subjects: ['r'], loop: false });
    expect(woke).toBe(2);
    expect(t.inert).toBe(false);
  });

  it('holds a pending start back for a voice cued at its moment, before the sync', () => {
    for (const order of ['cue-then-sync', 'sync-then-cue'] as const) {
      const { t, orbs, runs } = stage();
      t.sync(0);
      orbs.cue({ patch: fly(300), score: 's', tags: ['motion'], loop: false });
      runs.cue({
        patch: type(100),
        name: 'next',
        loop: false,
        anchor: { start: { after: { score: 's', tag: 'motion', resolver: 'latest' } } },
      });
      t.sync(200);
      const late = () =>
        orbs.cue({ patch: fly(500), score: 's', tags: ['motion'], loop: false, start: 300 });
      if (order === 'cue-then-sync') {
        late();
        t.sync(300);
        expect(starts(t, 'next')).toEqual([800]);
      } else {
        t.sync(300);
        late();
        t.sync(316);
        expect(starts(t, 'next')).toEqual([300]);
      }
    }
  });

  it('plays a late mix voice with an earlier start partway', () => {
    const t = transport();
    t.sync(0);
    t.sync(500);
    const late = mix<string, Flight>(FLIGHT, { transport: t, name: 'late' });
    late.cue({ patch: fly(1000), subjects: ['f'], loop: false, start: 0 });
    t.sync(516);
    expect(late.probe('f').u).toBeCloseTo(0.516, 9);
  });

  it('seeks every mix back in step, and plays calls across them again in order', () => {
    const { t, orbs, runs } = stage({ ms: 10_000, tape });
    t.sync(0);
    t.sync(100);
    orbs.cue({ patch: fly(300), name: 'f', score: 's', subjects: ['f'], loop: false });
    t.sync(150);
    runs.cue({
      patch: type(200),
      name: 'r',
      subjects: ['r'],
      loop: false,
      anchor: { start: { after: { score: 's', name: 'f' } } },
    });
    t.sync(700);
    const before = t.marks(0, 10_000);
    t.seek(50);
    expect(orbs.voices()).toHaveLength(0);
    expect(runs.voices()).toHaveLength(0);
    // The host's clock reads on from the seek: 1350 is mix time 700 again, 650 later on the host.
    t.sync(1350);
    expect(orbs.now).toBe(700);
    expect(t.marks(650, 10_650).map((m) => ({ ...m, timestamp: m.timestamp - 650 }))).toEqual(
      before,
    );
    t.seek(500);
    expect(runs.probe('r').chars).toBe(5);
  });

  it('branches the whole tape on a call after a seek back', () => {
    const { t, orbs, runs } = stage({ ms: 10_000, tape });
    t.sync(0);
    t.sync(100);
    orbs.cue({ patch: fly(300), name: 'f', subjects: ['f'], loop: false });
    t.sync(200);
    runs.cue({ patch: type(300), name: 'r', subjects: ['r'], loop: false });
    t.sync(300);
    t.seek(50);
    runs.cue({ patch: type(300), name: 'other', subjects: ['r'], loop: false });
    t.sync(1000);
    expect(orbs.voices()).toHaveLength(0);
    expect(starts(t, 'f')).toEqual([]);
    expect(starts(t, 'r')).toEqual([]);
  });

  it('puts a dropped mix back on a seek before the drop, under history', () => {
    const { t, orbs, runs } = stage({ ms: 10_000, tape });
    t.sync(0);
    runs.cue({ patch: type(100), subjects: ['r'], loop: false, freeze: 'after' });
    t.sync(100);
    t.drop(runs);
    expect(() => runs.cue({ patch: type(100) })).toThrow(/dropped/);
    expect(t.marks(0, 10_000).some((m) => m.mix === 'runs')).toBe(false);
    t.sync(400);
    t.seek(50);
    expect(runs.probe('r').chars).toBe(5);
    expect(t.marks(0, 10_000).some((m) => m.mix === 'runs')).toBe(true);
    t.sync(420);
    expect(orbs.now).toBe(70);
    expect(runs.probe('r').chars).toBe(7);
    // Playing past mix time 100 drops it again.
    t.sync(500);
    expect(() => runs.cue({ patch: type(100) })).toThrow(/dropped/);
    expect(t.marks(0, 10_000).some((m) => m.mix === 'runs')).toBe(false);
  });

  it('lets a dropped mix go for good without history', () => {
    const { t, runs } = stage();
    t.sync(0);
    runs.cue({ patch: type(1000), subjects: ['r'], loop: false });
    t.drop(runs);
    expect(t.marks(0, 10_000)).toEqual([]);
    expect(() => t.drop(runs)).toThrow(/not on this transport/);
  });

  it('keeps the tape to what history reaches, give or take its pruning step', () => {
    const { t, orbs } = stage({ ms: 2000, tape });
    t.sync(0);
    for (let k = 1; k <= 600; k++) {
      orbs.cue({ patch: fly(10), subjects: [`f${k}`], loop: false });
      t.sync(k * 16);
    }
    const kept = (t as unknown as { tape: { undoDepth(): number } }).tape.undoDepth();
    // A call a frame for 2 s is 125; the step lets go of them a second at a time.
    expect(kept).toBeGreaterThanOrEqual(125);
    expect(kept).toBeLessThanOrEqual(125 + 63);
    // Still sought within reach after the tape let go of what came before it.
    expect(() => t.seek(600 * 16 - 1500)).not.toThrow();
  });

  it('reaches its first sync with history that never lets go', () => {
    const { t, orbs } = stage({ ms: Number.POSITIVE_INFINITY, tape });
    t.sync(0);
    orbs.cue({ patch: fly(100), subjects: ['f'], loop: false });
    for (let k = 1; k <= 100; k++) t.sync(k * 1000);
    t.seek(50);
    expect(orbs.probe('f').u).toBeCloseTo(0.5, 9);
  });

  it('finds a voice cued on a score by a mix an earlier read found holding nothing there', () => {
    const { t, orbs, runs } = stage();
    t.sync(0);
    orbs.cue({ patch: fly(100), name: 'a', score: 's', loop: false });
    t.sync(200);
    // Nothing on 's' is named 'z', so this waits, reading 's' every frame after 'a' has gone.
    runs.cue({
      patch: type(100),
      name: 'w',
      loop: false,
      anchor: { start: { after: { score: 's', name: 'z' } } },
    });
    t.sync(210);
    orbs.cue({ patch: fly(100), name: 'b', score: 's', loop: false });
    runs.cue({
      patch: type(100),
      name: 'w2',
      loop: false,
      anchor: { start: { after: { score: 's', name: 'b' } } },
    });
    t.sync(220);
    expect(starts(runs, 'w2')).toEqual([310]);
  });

  it('finds the voices on a score of a mix put back by a seek before its drop', () => {
    const { t, orbs, runs } = stage({ ms: 10_000, tape });
    t.sync(0);
    orbs.cue({ patch: fly(300), name: 'f', score: 's', subjects: ['f'], loop: false });
    t.sync(20);
    t.drop(orbs);
    t.sync(40);
    t.seek(10);
    runs.cue({
      patch: type(100),
      name: 'w',
      loop: false,
      anchor: { start: { after: { score: 's', name: 'f' } } },
    });
    t.sync(50);
    const end = t.marks(0, 10_000).find((m) => m.name === 'f' && m.mark === 'end');
    expect(starts(runs, 'w')).toEqual([end?.timestamp]);
  });

  it('finds the voices on a score of a mix a seek pages back in', async () => {
    const f = () => ({ patch: fly(100), name: 'f', score: 's', subjects: ['f'], loop: false });
    const t = transport({ history: { ms: 100, every: 50, tape, store: memoryStore(), revive: f } });
    const orbs = mix<string, Flight>(FLIGHT, { transport: t, name: 'orbs' });
    const runs = mix<string, Row>(ROWS, { transport: t, name: 'runs' });
    t.sync(0);
    orbs.cue({ ...f(), as: { kind: 'f', data: {} } });
    // Waits on 's' every frame, after history has paged 'f' out.
    runs.cue({
      patch: type(100),
      subjects: ['r'],
      loop: false,
      anchor: { start: { after: { score: 's', name: 'z' } } },
    });
    for (let k = 1; k <= 40; k++) t.sync(k * 16);
    await t.prepare(50);
    t.seek(50);
    runs.cue({
      patch: type(100),
      name: 'w',
      subjects: ['r'],
      loop: false,
      anchor: { start: { after: { score: 's', name: 'f' } } },
    });
    t.sync(660);
    const end = t.marks(0, 10_000).find((m) => m.name === 'f' && m.mark === 'end');
    expect(starts(runs, 'w')).toEqual([end?.timestamp]);
  });
});
