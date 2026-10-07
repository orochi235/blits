import { glide, keys, mix, patch, spring, toHex, tween } from '@msb235/blits';
import { compile, FRAME, mixedStop } from '@pg/blits/compile';
import type { Composition, PatchSource, Voice } from '@pg/blits/composition';
import { KIT, type Mixed } from '@pg/blits/kit';
import { subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

const voice = (v: Partial<Voice> & Pick<Voice, 'id' | 'patch'>): Voice => ({
  name: v.id,
  hue: 0,
  start: 0,
  rate: 1,
  loop: true,
  weight: 1,
  fade: {},
  ...v,
});
const comp = (voices: Voice[]): Composition => ({
  version: 1,
  title: 't',
  stage: { kind: 'dots', cols: 3, rows: 2 },
  length: 2000,
  levels: [],
  voices,
});
const subjects = subjectsOf({ kind: 'dots', cols: 3, rows: 2 });

/** Plays both mixes frame by frame and compares every subject's pose, to the bit. */
function same(a: ReturnType<typeof mix<(typeof subjects)[0], Mixed>>, b: typeof a, ms = 1500) {
  for (let t = 0; t <= ms; t += FRAME) {
    a.sync(t);
    b.sync(t);
    for (const s of subjects) expect(a.probe(s)).toStrictEqual(b.probe(s));
  }
}

describe('compile', () => {
  it('a keys voice gives the poses the hand-written cue gives', () => {
    const stops = [
      { at: 0, delta: { scale: 1, offset: [0, 0] } },
      { at: 1, delta: { scale: 2, offset: [10, -5] } },
    ];
    const built = compile(
      comp([
        voice({
          id: 'a',
          patch: { kind: 'keys', period: 500, stops },
          loop: 2,
          stagger: { code: '(s) => s.col * 100' },
          fade: { in: 200 },
        }),
      ]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Mixed>(KIT, { stepMs: FRAME });
    hand.cue({ patch: keys(500, stops), loop: 2, stagger: (s) => s.col * 100, fade: { in: 200 } });
    expect(built.errors).toEqual([]);
    same(built.mix, hand);
  });

  it('a fn voice with state and step gives the hand-written poses', () => {
    const at = '(phase, s, set) => ({ turn: set.state.n + phase * s.col })';
    const built = compile(
      comp([
        voice({
          id: 'f',
          patch: {
            kind: 'fn',
            period: 300,
            writes: ['turn'],
            at,
            state: '() => ({ n: 0 })',
            step: '(st) => { st.n++; }',
          },
        }),
      ]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Mixed>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: patch<(typeof subjects)[0], Mixed, { n: number }>(
        300,
        (phase, s, set) => ({ turn: set.state.n + phase * s.col }),
        {
          writes: ['turn'],
          state: () => ({ n: 0 }),
          step: (st) => {
            st.n++;
          },
        },
      ),
    });
    same(built.mix, hand);
  });

  it('a spring voice gives the hand-written poses', () => {
    const built = compile(
      comp([
        voice({
          id: 's',
          patch: {
            kind: 'spring',
            channel: 'offset',
            opts: { to: { code: '(s) => [s.col * 10, 0]' }, from: [0, 0], stiffness: 120 },
          },
        }),
      ]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Mixed>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: spring<(typeof subjects)[0], Mixed, number[]>('offset', {
        to: (s) => [s.col * 10, 0],
        from: [0, 0],
        stiffness: 120,
      }),
    });
    same(built.mix, hand);
  });

  it('a glide voice gives the hand-written poses', () => {
    const built = compile(
      comp([
        voice({
          id: 'g',
          patch: {
            kind: 'glide',
            channel: 'turn',
            opts: { from: 0, velocity: { code: '(s) => s.col * 40' }, ms: 400 },
          },
        }),
      ]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Mixed>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: glide<(typeof subjects)[0], Mixed, number>('turn', {
        from: 0,
        velocity: (s) => s.col * 40,
        ms: 400,
      }),
    });
    expect(built.errors).toEqual([]);
    same(built.mix, hand);
  });

  it('a tween voice gives the hand-written poses', () => {
    const built = compile(
      comp([
        voice({
          id: 'w',
          patch: {
            kind: 'tween',
            channel: 'scale',
            opts: {
              from: 1,
              to: { code: '(s) => 1 + s.row' },
              ms: { code: '(s) => 300 + s.col * 100' },
            },
            ease: 'linear',
          },
        }),
      ]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Mixed>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: tween<(typeof subjects)[0], Mixed, number>('scale', {
        from: 1,
        to: (s) => 1 + s.row,
        ms: (s) => 300 + s.col * 100,
        ease: 'linear',
      }),
    });
    expect(built.errors).toEqual([]);
    same(built.mix, hand);
  });

  it('a motion option that throws for some subjects falls back to the channel rest', () => {
    const built = compile(
      comp([
        voice({
          id: 's',
          patch: {
            kind: 'spring',
            channel: 'offset',
            opts: {
              to: { code: '(s) => (s.col === 1 ? s.nope.x : [s.col * 10, 0])' },
              from: [5, 5],
            },
          },
        }),
      ]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Mixed>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: spring<(typeof subjects)[0], Mixed, number[]>('offset', {
        to: (s) => (s.col === 1 ? [0, 0] : [s.col * 10, 0]),
        from: [5, 5],
      }),
    });
    expect(built.errors).toEqual([]);
    same(built.mix, hand, 3000);
    const thrown = subjects.find((s) => s.col === 1) as (typeof subjects)[0];
    expect(built.mix.probe(thrown).offset).toEqual([0, 0]);
    expect(built.faults.get('s')?.count).toBeGreaterThan(0);
  });

  it('a motion patch blits refuses to build is a field error, and compile returns', () => {
    const ok = voice({
      id: 'ok',
      patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 1 } }] },
    });
    const zero = voice({
      id: 'zero',
      patch: { kind: 'tween', channel: 'scale', opts: { from: 1, to: 2, ms: 0 } },
    });
    const aimless = voice({
      id: 'aimless',
      patch: { kind: 'spring', channel: 'offset', opts: { from: [0, 0] } },
    });
    const built = compile(comp([zero, aimless, ok]), subjects);
    expect(built.errors.map((e) => [e.voice, e.field])).toEqual([
      ['zero', 'opts.ms'],
      ['aimless', 'opts.to'],
    ]);
    built.mix.sync(0);
    expect(built.mix.probe(subjects[0] as never).glow).toBe(1);
    expect([...built.handles.keys()]).toEqual(['ok']);
  });

  it('an expression on an option that takes a number is a field error, and every one is named', () => {
    const v = voice({
      id: 'g',
      patch: {
        kind: 'glide',
        channel: 'turn',
        opts: { from: { code: '(s) =>' }, ms: { code: '(s) => 300' }, settle: { code: '() => 0' } },
      },
    });
    const built = compile(comp([v]), subjects);
    expect(built.errors.map((e) => [e.field, e.error === 'takes a number'])).toEqual([
      ['opts.from', false],
      ['opts.ms', true],
      ['opts.settle', true],
    ]);
    expect(built.handles.size).toBe(0);
  });

  it('a tween whose ms throws for a subject snaps that subject to the fallback target', () => {
    const built = compile(
      comp([
        voice({
          id: 'w',
          patch: {
            kind: 'tween',
            channel: 'scale',
            opts: { from: 2, to: 3, ms: { code: '(s) => (s.col === 1 ? s.nope.x : 500)' } },
          },
        }),
      ]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Mixed>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: tween<(typeof subjects)[0], Mixed, number>('scale', {
        from: 2,
        to: 3,
        ms: (s) => (s.col === 1 ? FRAME : 500),
      }),
    });
    expect(built.errors).toEqual([]);
    same(built.mix, hand);
    expect(built.mix.probe(subjects.find((s) => s.col === 1) as never).scale).toBe(3);
  });

  it('an option expression returning what blits refuses counts a fault and uses the fallback', () => {
    const built = compile(
      comp([
        voice({
          id: 'w',
          patch: {
            kind: 'tween',
            channel: 'scale',
            opts: { from: 2, to: 3, ms: { code: '(s) => s.col * 100' } },
          },
        }),
        voice({
          id: 's',
          patch: {
            kind: 'spring',
            channel: 'offset',
            opts: { to: { code: '(s) => (s.col === 2 ? [1, 2, 3] : [s.col, 0])' }, from: [5, 5] },
          },
        }),
      ]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Mixed>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: tween<(typeof subjects)[0], Mixed, number>('scale', {
        from: 2,
        to: 3,
        ms: (s) => (s.col === 0 ? FRAME : s.col * 100),
      }),
    });
    hand.cue({
      patch: spring<(typeof subjects)[0], Mixed, number[]>('offset', {
        to: (s) => (s.col === 2 ? [0, 0] : [s.col, 0]),
        from: [5, 5],
      }),
    });
    expect(built.errors).toEqual([]);
    same(built.mix, hand);
    expect(built.faults.get('w')?.count).toBeGreaterThan(0);
    expect(built.faults.get('w')?.first).toBe('opts.ms takes a positive number');
    expect(built.faults.get('s')?.first).toBe('opts.to takes 2 numbers');
  });

  it('a fixed option of the wrong shape is a field error', () => {
    const v = voice({
      id: 's',
      patch: { kind: 'spring', channel: 'offset', opts: { to: 5, from: [0, 0, 0] } },
    });
    expect(compile(comp([v]), subjects).errors.map((e) => [e.field, e.error])).toEqual([
      ['opts.to', 'takes 2 numbers'],
      ['opts.from', 'takes 2 numbers'],
    ]);
  });

  it('voices fold in the order the composition lists them', () => {
    const layer = (id: string, turn: number, color: number) =>
      voice({
        id,
        patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { turn, color } }] },
      });
    const order = [layer('a', 0.1, 0xff0000), layer('b', 0.2, 0x00ff00), layer('c', 0.3, 0x0000ff)];
    for (const voices of [order, [...order].reverse()]) {
      const built = compile(comp(voices), subjects);
      const hand = mix<(typeof subjects)[0], Mixed>(KIT, { stepMs: FRAME });
      for (const v of voices)
        if (v.patch.kind === 'keys') hand.cue({ patch: keys(100, v.patch.stops.map(mixedStop)) });
      same(built.mix, hand, 100);
    }
    const forward = compile(comp(order), subjects).mix;
    const back = compile(comp([...order].reverse()), subjects).mix;
    forward.sync(0);
    back.sync(0);
    const s0 = subjects[0] as never;
    expect(forward.probe(s0).turn).not.toBe(back.probe(s0).turn);
    expect(toHex(forward.probe(s0).color)).toBe(0x0000ff);
    expect(toHex(back.probe(s0).color)).toBe(0xff0000);
  });

  it('skips a voice with a bad expression, names the field, and keeps the rest', () => {
    const ok = voice({
      id: 'ok',
      patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 1 } }] },
    });
    const bad = voice({ id: 'bad', patch: ok.patch, stagger: { code: '(s) =>' } });
    const built = compile(comp([ok, bad]), subjects);
    expect(built.errors.map((e) => [e.voice, e.field])).toEqual([['bad', 'stagger']]);
    built.mix.sync(0);
    expect(built.mix.probe(subjects[0] as never).glow).toBe(1);
    expect(built.handles.has('bad')).toBe(false);
    expect([...built.patches.keys()]).toEqual(['ok']);
  });

  it('a voice reusing an earlier voice’s name is a field error and is not cued', () => {
    const p: PatchSource = { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 1 } }] };
    const built = compile(
      comp([voice({ id: 'a', name: 'x', patch: p }), voice({ id: 'b', name: 'x', patch: p })]),
      subjects,
      { solos: true },
    );
    expect(built.errors).toEqual([
      { voice: 'b', field: 'name', error: 'another voice is named "x"', line: null },
    ]);
    expect([...built.handles.keys()]).toEqual(['a']);
    expect([...built.solos.keys()]).toEqual(['a']);
  });

  it('an anchor to a voice that does not exist leaves the voice pending without throwing', () => {
    const v = voice({
      id: 'late',
      patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 1 } }] },
      anchor: { start: { after: 'gone' } },
    });
    const built = compile(comp([v]), subjects);
    built.mix.sync(0);
    built.mix.sync(500);
    expect(built.handles.get('late')?.state).toBe('pending');
  });

  it('an anchor on the out mark only keeps the voice start', () => {
    const glow = { kind: 'keys' as const, period: 100, stops: [{ at: 0, delta: { glow: 1 } }] };
    const a = voice({
      id: 'a',
      name: 'a',
      start: 500,
      patch: glow,
      anchor: { out: { with: 'b' } },
    });
    const b = voice({ id: 'b', name: 'b', start: 2000, patch: glow });
    const built = compile(comp([a, b]), subjects);
    built.mix.sync(100);
    expect(built.handles.get('a')?.state).toBe('pending');
    built.mix.sync(600);
    expect(built.handles.get('a')?.state).toBe('live');
  });

  it('a solo mix shows one voice as if the others were silent', () => {
    const a = voice({
      id: 'a',
      patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 0.5 } }] },
    });
    const b = voice({
      id: 'b',
      patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 0.9 } }] },
    });
    const built = compile(comp([a, b]), subjects, { solos: true });
    const solo = built.solos.get('a');
    solo?.sync(0);
    expect(solo?.probe(subjects[0] as never).glow).toBe(0.5);
  });

  it('a level is shared by every mix', () => {
    const c = comp([
      voice({
        id: 'w',
        patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 1 } }] },
        weight: { code: 'level("k")' },
      }),
    ]);
    c.levels = [{ name: 'k', value: 0.25, min: 0, max: 1 }];
    const built = compile(c, subjects, { solos: true });
    built.mix.sync(0);
    expect(built.mix.probe(subjects[0] as never).glow).toBeCloseTo(0.25, 12);
    built.levels.get('k')?.set(1);
    built.mix.sync(FRAME);
    built.solos.get('w')?.sync(FRAME);
    expect(built.mix.probe(subjects[0] as never).glow).toBe(1);
    expect(built.solos.get('w')?.probe(subjects[0] as never).glow).toBe(1);
  });
});
