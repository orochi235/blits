import { glide, keys, mix, patch, spring, tween } from '@msb235/blits';
import { compile, FRAME } from '@pg/blits/compile';
import type { Composition, Voice } from '@pg/blits/composition';
import { KIT, type Pose } from '@pg/blits/kit';
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
function same(a: ReturnType<typeof mix<(typeof subjects)[0], Pose>>, b: typeof a, ms = 1500) {
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
    const hand = mix<(typeof subjects)[0], Pose>(KIT, { stepMs: FRAME });
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
    const hand = mix<(typeof subjects)[0], Pose>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: patch<(typeof subjects)[0], Pose, { n: number }>(
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
    const hand = mix<(typeof subjects)[0], Pose>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: spring<(typeof subjects)[0], Pose, number[]>('offset', {
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
    const hand = mix<(typeof subjects)[0], Pose>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: glide<(typeof subjects)[0], Pose, number>('turn', {
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
          },
        }),
      ]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Pose>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: tween<(typeof subjects)[0], Pose, number>('scale', {
        from: 1,
        to: (s) => 1 + s.row,
        ms: (s) => 300 + s.col * 100,
      }),
    });
    expect(built.errors).toEqual([]);
    same(built.mix, hand);
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
