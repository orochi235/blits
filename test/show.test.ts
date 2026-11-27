import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { curve } from '../src/easing.js';
import { mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { type Kind, play, type Show } from '../src/show.js';
import type { Handle, Mix, MixOptions } from '../src/types.js';

interface Pose {
  a: number;
  b: number;
  c: number;
}
const K = kit<Pose>({ a: sum(), b: sum(), c: sum() });
interface Row {
  id: string;
}
type M = Mix<Row, Pose>;
const r = { id: 'r' };

/** Writes its phase to one channel, over the cue's length or its own. */
const ramp =
  (ch: keyof Pose, own = 100): Kind<Row, Pose> =>
  (_params, { length }) =>
    patch<Row, Pose>(length ?? own, (u) => ({ [ch]: u }) as Partial<Pose>, { writes: [ch] });

/** Writes `params.level` to one channel. */
const flat =
  (ch: keyof Pose, own = 100): Kind<Row, Pose> =>
  (params, { length }) =>
    patch<Row, Pose>(length ?? own, () => ({ [ch]: params.level ?? 1 }) as Partial<Pose>, {
      writes: [ch],
    });

const KINDS = {
  a: ramp('a'),
  b: ramp('b'),
  c: ramp('c'),
  fa: flat('a'),
  fb: flat('b'),
  fc: flat('c'),
};

const make = (opts: MixOptions = {}) => {
  const m = mix<Row, Pose>(K, opts);
  m.sync(0);
  return m;
};

const round = (v: number) => Math.round(v * 1000) / 1000;
const at = (m: M, t: number) => {
  m.sync(t);
  const p = m.probe(r);
  return [p.a, p.b, p.c].map(round);
};
const ahead = (m: M, t: number) => {
  const p = m.project(t).probe(r);
  return [p.a, p.b, p.c].map(round);
};

const marksOf = (m: M, name: string) =>
  Object.fromEntries(
    m
      .marks(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)
      .filter((e) => e.name === name)
      .map((e) => [e.mark, round(e.timestamp)]),
  );

const TIMES = [0, 50, 100, 150, 199, 250, 300, 360, 420, 500, 640, 800, 1000];

/** Every field a show carries, kind cues and an arc cue, anchored and not. */
const FULL: Show = {
  name: 'full',
  duration: 1000,
  cues: [
    { name: 'one', kind: 'a', start: 0, length: 300, fade: { in: 50, out: 100, ease: 'ease-in' } },
    {
      name: 'two',
      kind: 'fb',
      start: { after: 'one', by: -100 },
      length: 200,
      params: { level: 0.5 },
    },
    { kind: 'c', start: 400, end: 600, ease: { bezier: [0.3333, 0, 0.6667, 1] } },
    { kind: 'fa', start: 700, freeze: 'after', length: 100, muted: true },
    {
      name: 'arc',
      start: { with: 'two', by: 300 },
      enter: { kind: 'fb', length: 100 },
      active: [{ kind: 'fc' }, { kind: 'a', length: 80 }],
      exit: { kind: 'fb', params: { level: 0.25 } },
      hold: 200,
      blend: 40,
      fade: { in: 20 },
    },
  ],
};

describe('a show', () => {
  it('round-trips through JSON and plays the same after', () => {
    const copy = JSON.parse(JSON.stringify(FULL)) as Show;
    expect(copy).toEqual(FULL);
    const run = (show: Show) => {
      const m = make();
      play(m, show, KINDS);
      return TIMES.map((t) => ahead(m, t));
    };
    expect(run(copy)).toEqual(run(FULL));
  });

  it('puts each kind cue field on its voice', () => {
    const m = make();
    const seen: unknown[] = [];
    const h = play(m, FULL, {
      ...KINDS,
      fb: (params, input) => {
        seen.push([params, input.length]);
        return flat('b')(params, input);
      },
    });
    expect(h.cues.map((c) => c.length)).toEqual([1, 1, 1, 1, 1]);
    // name, start, length and fade: in at 50, out from 200 to 300.
    expect(marksOf(m, 'one')).toMatchObject({ start: 0, in: 50, out: 200, end: 300 });
    // params and the length the kind is handed; the arc's enter is handed its piece's.
    expect(seen).toEqual([
      [{ level: 0.5 }, 200],
      [{}, 100],
      [{ level: 0.25 }, undefined],
    ]);
    // fade.ease: 25 ms into a 50 ms ease-in.
    const easeIn = curve('ease-in');
    expect(ahead(m, 25)[0]).toBe(round((25 / 300) * easeIn(0.5)));
    // end: the third cue plays from 400 to 600, its phase through the bezier.
    expect(ahead(m, 450)[2]).toBe(round(curve({ bezier: [0.3333, 0, 0.6667, 1] })(0.25)));
    expect(ahead(m, 390)[2]).toBe(0);
    // freeze after, with no end of its own: the muted fourth still holds the show.
    expect(h.cues[3]?.[0]?.weight).toBe(0);
    at(m, 900);
    expect(h.cues[3]?.[0]?.state).toBe('frozen');
    expect(h.state).toBe('live');
  });

  it('starts a cue on an anchor, and ends it a length after', () => {
    const m = make();
    play(m, FULL, KINDS);
    // "two" starts 100 before "one" ends, and lasts 200.
    expect(marksOf(m, 'two')).toMatchObject({ start: 200, end: 400 });
    expect(ahead(m, 250)[1]).toBe(0.5);
    // `before`, and `all` over two, shift by the length too.
    const n = make();
    play(
      n,
      {
        cues: [
          { name: 'x', kind: 'a', start: 300, length: 100 },
          { name: 'y', kind: 'b', start: 100, length: 100 },
          { name: 'p', kind: 'c', start: { before: 'x', by: 50 }, length: 30 },
          { name: 'q', kind: 'c', start: { all: [{ after: 'x' }, { after: 'y' }] }, length: 70 },
        ],
      },
      KINDS,
    );
    expect(marksOf(n, 'p')).toMatchObject({ start: 250, end: 280 });
    expect(marksOf(n, 'q')).toMatchObject({ start: 400, end: 470 });
  });

  it('plays an arc cue as the arc written by hand', () => {
    const fromShow = make();
    play(fromShow, { cues: [{ ...(FULL.cues[4] as Show['cues'][number]), start: 0 }] }, KINDS);
    const byHand = make();
    const owner = byHand.owns({});
    byHand.arc({
      owner,
      anchor: { start: 0 },
      name: 'arc',
      fade: { in: 20 },
      enter: { patch: flat('b')({}, { length: 100, cue: { kind: 'fb' } }) as never, duration: 100 },
      active: [
        { patch: flat('c')({}, { length: undefined, cue: { kind: 'fc' } }) as never },
        { patch: ramp('a')({}, { length: 80, cue: { kind: 'a' } }) as never, duration: 80 },
      ],
      exit: {
        patch: flat('b')({ level: 0.25 }, { length: undefined, cue: { kind: 'fb' } }) as never,
      },
      hold: 200,
      blend: 40,
    });
    const times = [0, 10, 80, 100, 120, 200, 290, 300, 320, 380, 420];
    expect(times.map((t) => ahead(fromShow, t))).toEqual(times.map((t) => ahead(byHand, t)));
    expect(marksOf(fromShow, 'arc')).toEqual(marksOf(byHand, 'arc'));
  });

  it('cues a muted cue at weight 0, and its handle unmutes it', () => {
    const m = make();
    const h = play(
      m,
      {
        cues: [
          { name: 'm', kind: 'fa', start: 0, length: 500, muted: true },
          { name: 'n', kind: 'fb', start: { after: 'm' }, length: 100 },
          { name: 'z', start: 0, muted: true, active: { kind: 'fc' }, hold: 500 },
        ],
      },
      KINDS,
    );
    expect(at(m, 100)).toEqual([0, 0, 0]);
    // Anchors to it still answer.
    expect(marksOf(m, 'n')).toMatchObject({ start: 500, end: 600 });
    (h.cues[0]?.[0] as Handle<Row>).weight = 1;
    (h.cues[2]?.[0] as Handle<Row>).weight = 1;
    expect(at(m, 200)).toEqual([1, 0, 1]);
  });

  it('seeks and reads ahead as the same mix scheduled by hand', () => {
    const opts = { history: { ms: 10_000, tape } };
    const fromShow = make(opts);
    play(fromShow, FULL, KINDS);
    const byHand = make(opts);
    const owner = byHand.owns({ name: 'full', fade: { out: 100 } });
    const fn = (k: Kind<Row, Pose>, params: Record<string, number>, length: number) =>
      k(params, { length, cue: { kind: '' } }) as never;
    byHand.cue({
      owner,
      name: 'one',
      patch: fn(ramp('a'), {}, 300),
      anchor: { start: 0, end: 300 },
      fade: { in: 50, out: 100, ease: 'ease-in' },
    });
    byHand.cue({
      owner,
      name: 'two',
      patch: fn(flat('b'), { level: 0.5 }, 200),
      anchor: { start: { after: 'one', by: -100 }, end: { after: 'one', by: 100 } },
    });
    const c = fn(ramp('c'), {}, 200) as ReturnType<typeof patch<Row, Pose>>;
    const ease = curve({ bezier: [0.3333, 0, 0.6667, 1] });
    byHand.cue({
      owner,
      patch: patch<Row, Pose>(200, (u, s, set) => c.at(ease(u), s, set), { writes: ['c'] }),
      anchor: { start: 400, end: 600 },
    });
    byHand.cue({
      owner,
      patch: fn(flat('a'), {}, 100),
      anchor: { start: 700 },
      freeze: 'after',
      weight: 0,
    });
    byHand.arc({
      owner,
      name: 'arc',
      anchor: { start: { with: 'two', by: 300 } },
      fade: { in: 20 },
      enter: { patch: fn(flat('b'), {}, 100), duration: 100 },
      active: [
        { patch: flat('c')({}, { length: undefined, cue: { kind: '' } }) as never },
        { patch: fn(ramp('a'), {}, 80), duration: 80 },
      ],
      exit: {
        patch: flat('b')({ level: 0.25 }, { length: undefined, cue: { kind: '' } }) as never,
      },
      hold: 200,
      blend: 40,
    });
    const both = (f: (m: M) => number[]) => [f(fromShow), f(byHand)];
    for (const t of TIMES) {
      const [a, b] = both((m) => at(m, t));
      expect(a, `play at ${t}`).toEqual(b);
    }
    for (const t of [640, 120, 360, 0, 900]) {
      for (const m of [fromShow, byHand]) m.seek(t);
      const [a, b] = both((m) => {
        const p = m.probe(r);
        return [p.a, p.b, p.c].map(round);
      });
      expect(a, `seek to ${t}`).toEqual(b);
      const [pa, pb] = both((m) => ahead(m, t + 130));
      expect(pa, `read ahead from ${t}`).toEqual(pb);
    }
  });

  it('refuses what it cannot play', () => {
    const m = make();
    const bad =
      (cue: object, kinds: Record<string, Kind<Row, Pose>> = KINDS) =>
      () =>
        play(m, { cues: [cue as Show['cues'][number]] }, kinds);
    expect(bad({ kind: 'nope' })).toThrow(/kind "nope", which kinds lacks/);
    expect(bad({ kind: 'a', length: 10, end: 20 })).toThrow(/a length or an end, not both/);
    expect(bad({ kind: 'a', hold: 10 })).toThrow(/"hold", which a kind cue does not take/);
    expect(bad({ active: { kind: 'a' }, length: 10 })).toThrow(/"length", which an arc cue/);
    expect(bad({ kind: 'a', lenght: 10 })).toThrow(/"lenght"/);
    expect(bad({ knd: 'a' })).toThrow(/names no kind, and no enter, active or exit/);
    expect(bad({ active: { kind: 'nope' } })).toThrow(/active 0 plays kind "nope"/);
    expect(bad({ kind: 'a', freeze: 'after', end: 50 })).toThrow(/takes no end/);
    expect(
      bad(
        { kind: 's', ease: 'ease-in' },
        { s: () => tween<Row, Pose>('a', { from: 0, to: 1, ms: 100 }) },
      ),
    ).toThrow(/a motion runs by its own laws/);
  });

  it('eases a keys patch through its remap, as a patch() patch', () => {
    const ramped = (): Kind<Row, Pose> => () =>
      keys<Row, Pose>(200, [
        { at: 0, delta: { a: 0 } },
        { at: 1, delta: { a: 1 } },
      ]);
    const m = make({ history: { ms: 1e9, every: 50, tape } });
    play(m, { cues: [{ kind: 'k', start: 0, ease: 'ease-in', freeze: 'after' }] }, { k: ramped() });
    const easeIn = curve('ease-in');
    expect(ahead(m, 50)[0]).toBe(round(easeIn(0.25)));
    expect(at(m, 100)[0]).toBe(round(easeIn(0.5)));
    expect(at(m, 150)[0]).toBe(round(easeIn(0.75)));
    m.seek(50);
    expect(round(m.probe(r).a)).toBe(round(easeIn(0.25)));
  });

  it('checks every cue before cueing any, and drops what a throwing kind left', () => {
    const m = make();
    const before = m.voices().length;
    expect(() =>
      play(m, { cues: [{ kind: 'fa', freeze: 'after' }, { kind: 'nope' }] }, KINDS),
    ).toThrow(/nope/);
    expect(m.voices().length).toBe(before);
    const n = make();
    expect(() =>
      play(
        n,
        { cues: [{ kind: 'fa', freeze: 'after' }, { kind: 'boom' }] },
        {
          ...KINDS,
          boom: () => {
            throw new Error('boom');
          },
        },
      ),
    ).toThrow('boom');
    expect(at(n, 50)).toEqual([0, 0, 0]);
  });

  it('keeps the weight a kind gave a muted cue, for its unmute', () => {
    const m = make();
    const h = play(
      m,
      { cues: [{ kind: 'w', muted: true }] },
      {
        w: () => ({
          patch: flat('a')({}, { length: 1000, cue: { kind: 'w' } }) as never,
          weight: () => 0.25,
        }),
      },
    );
    expect(at(m, 10)[0]).toBe(0);
    (h.cues[0]?.[0] as Handle<Row>).weight = 1;
    expect(at(m, 20)[0]).toBe(0.25);
  });

  it('names only the first of the voices a kind layers', () => {
    const m = make();
    const h = play(
      m,
      { cues: [{ name: 'two', kind: 'w', start: 0, length: 100 }] },
      {
        w: (_p, input) => [
          { patch: flat('a')({}, input) as never },
          { patch: flat('b')({ level: 0.5 }, input) as never },
        ],
      },
    );
    expect(h.cues[0]).toHaveLength(2);
    expect(at(m, 50)).toEqual([1, 0.5, 0]);
    expect(m.marks(0, 1000).filter((k) => k.name === 'two' && k.mark === 'start')).toHaveLength(1);
  });

  it('fades the whole show out over its longest fade.out', () => {
    const m = make();
    const h = play(
      m,
      {
        cues: [
          { kind: 'fa', start: 0, length: 5000, fade: { out: 400 } },
          { kind: 'fb', start: 0, length: 5000, fade: { out: 200 } },
        ],
      },
      KINDS,
    );
    at(m, 100);
    h.fade();
    expect(at(m, 300)).toEqual([0.5, 0.5, 0]);
    expect(h.state).toBe('fading');
    at(m, 600);
    expect(h.state).toBe('done');
  });

  it('drops a show with no cues as it plays it', () => {
    const m = make();
    const h = play(m, { cues: [] }, KINDS);
    at(m, 10);
    expect(h.state).toBe('done');
  });
});
