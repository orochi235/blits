import {
  condense,
  keys,
  type Mix,
  mix,
  pipe,
  type SpanHandle,
  type SpanHints,
  shed,
} from '@msb235/blits';
import { compile } from '@pg/blits/compile';
import type { PatchSource, Voice } from '@pg/blits/composition';
import { fitFaultKey } from '@pg/blits/cueGroups';
import { FRAME } from '@pg/blits/frame';
import { KIT, type Mixed } from '@pg/blits/kit';
import type { Subject } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';
import { comp, group, same, subjects, voice } from './helpers';

const stops = [
  { at: 0, delta: { scale: 1 } },
  { at: 1, delta: { scale: 2 } },
];
const KEYS: PatchSource = { kind: 'keys', period: 400, stops };
const once = (id: string, over: Partial<Voice> = {}) =>
  voice({ id, patch: KEYS, loop: false, ...over });
const hand = () => mix<Subject, Mixed>(KIT, { stepMs: FRAME });
const resultOf = (m: Map<string, unknown>, id: string) => (m.get(id) as SpanHandle).result;

describe('compiling groups', () => {
  it('an owner gives the poses of the hand-written owns', () => {
    const built = compile(
      comp(
        [voice({ id: 'a', patch: KEYS, start: 50, loop: 2, owner: 'g' })],
        [group({ id: 'g', rate: 2, weight: 0.5, fade: { in: 200 }, start: 100 })],
      ),
      subjects,
    );
    expect(built.errors).toEqual([]);
    const m = hand();
    const h = m.owns({ start: 100, rate: 2, weight: 0.5, fade: { in: 200 } });
    m.cue({ patch: keys(400, stops), start: 50, loop: 2, owner: h });
    same(built.mix, m);
    expect(built.groupHandles.get('g')?.state).toBe(h.state);
  });

  it('a span gives the poses and the fit of the hand-written span', () => {
    const HINTS: SpanHints[] = [{ overlap: true }, { ballast: true }, { faster: 2 }];
    const built = compile(
      comp(
        HINTS.map((hints, i) => once(`v${i}`, { owner: 's', hints })),
        [
          group({
            id: 's',
            kind: 'span',
            span: {
              duration: 600,
              order: 'stagger',
              share: 0.3,
              fit: [{ kind: 'condense' }, { kind: 'shed' }],
            },
          }),
        ],
      ),
      subjects,
    );
    expect(built.errors).toEqual([]);
    const m = hand();
    const s = m.span({
      start: 0,
      duration: 600,
      order: 'stagger',
      share: 0.3,
      fit: pipe(condense(), shed()),
    });
    for (const hints of HINTS) m.cue({ patch: keys(400, stops), loop: false, owner: s, ...hints });
    same(built.mix, m);
    expect(resultOf(built.groupHandles, 's')).toEqual(s.result);
    expect(s.result.budget).toBe(600);
  });

  it('a span inside an owner is cued depth-first, as written by hand', () => {
    const built = compile(
      comp(
        [
          once('a', { owner: 's' }),
          once('c', { owner: 'o', start: 300 }),
          once('b', { owner: 's' }),
        ],
        [
          group({ id: 'o', start: 100, rate: 1.5 }),
          group({
            id: 's',
            kind: 'span',
            owner: 'o',
            span: { duration: 500 },
            hints: { faster: 2 },
          }),
        ],
      ),
      subjects,
    );
    expect(built.errors).toEqual([]);
    const m = hand();
    const o = m.owns({ start: 100, rate: 1.5 });
    const s = m.span({ start: 0, duration: 500, owner: o });
    m.cue({ patch: keys(400, stops), loop: false, owner: s });
    m.cue({ patch: keys(400, stops), loop: false, owner: s });
    m.cue({ patch: keys(400, stops), start: 300, loop: false, owner: o });
    same(built.mix, m);
    expect(resultOf(built.groupHandles, 's')).toEqual(s.result);
  });

  it('a span child with a start, a start anchor, or a loop that never ends is a field error', () => {
    const built = compile(
      comp(
        [
          once('ok1', { owner: 's' }),
          once('anchored', { owner: 's', anchor: { start: 200 } }),
          once('started', { owner: 's', start: 200 }),
          once('loopy', { owner: 's', loop: true }),
          once('ok2', { owner: 's' }),
        ],
        [group({ id: 's', kind: 'span', span: { duration: 600 } })],
      ),
      subjects,
    );
    expect(built.errors.map((e) => [e.voice, e.field])).toEqual([
      ['anchored', 'anchor'],
      ['started', 'start'],
      ['loopy', 'loop'],
    ]);
    const m = hand();
    const s = m.span({ start: 0, duration: 600 });
    m.cue({ patch: keys(400, stops), loop: false, owner: s });
    m.cue({ patch: keys(400, stops), loop: false, owner: s });
    same(built.mix, m);
  });

  it('a motion voice under a span is a field error on its patch', () => {
    const glide: PatchSource = { kind: 'glide', channel: 'turn', opts: { from: 0, velocity: 1 } };
    const built = compile(
      comp(
        [voice({ id: 'm', patch: glide, owner: 's' })],
        [group({ id: 's', kind: 'span', span: {} })],
      ),
      subjects,
    );
    expect(built.errors.map((e) => [e.voice, e.field])).toEqual([['m', 'patch']]);
  });

  it('a group with errors is left out with everything under it, and the rest still play', () => {
    const built = compile(
      comp(
        [once('a', { owner: 'g' }), once('b', { owner: 'g2' }), once('c')],
        [group({ id: 'g', weight: { code: '((' } }), group({ id: 'g2', owner: 'g' })],
      ),
      subjects,
      { solos: true },
    );
    expect(built.errors).toMatchObject([
      { voice: 'g', field: 'weight' },
      { voice: 'a', field: 'owner', error: 'its group "g" has errors', line: null },
      { voice: 'g2', field: 'owner', error: 'its group "g" has errors', line: null },
      { voice: 'b', field: 'owner', error: 'its group "g2" has errors', line: null },
    ]);
    expect([...built.groupHandles.keys()]).toEqual([]);
    expect([...built.solos.keys()]).toEqual(['c']);
    const m = hand();
    m.cue({ patch: keys(400, stops), start: 0, loop: false });
    same(built.mix, m);
  });

  it("a fit's code step that fails to compile is a field error on that step", () => {
    const built = compile(
      comp(
        [once('a', { owner: 's' })],
        [
          group({
            id: 's',
            kind: 'span',
            span: {
              fit: [{ kind: 'condense' }, { kind: 'code', code: '(span, kids, plan) =>\n )' }],
            },
          }),
        ],
      ),
      subjects,
    );
    expect(built.errors).toMatchObject([
      { voice: 's', field: 'span.fit.1', line: 2 },
      { voice: 'a', field: 'owner' },
    ]);
  });

  it("counts a group's weight and fit faults under the group's id", () => {
    const built = compile(
      comp(
        [once('a', { owner: 'o' }), once('b', { owner: 's' })],
        [
          group({ id: 'o', weight: { code: '(s) => { throw new Error("w"); }' } }),
          group({
            id: 's',
            kind: 'span',
            span: {
              duration: 200,
              fit: [
                { kind: 'condense' },
                { kind: 'code', code: '() => { throw new Error("f"); }' },
              ],
            },
          }),
        ],
      ),
      subjects,
    );
    expect(built.errors).toEqual([]);
    for (let t = 0; t <= 100; t += FRAME) {
      built.mix.sync(t);
      for (const s of subjects) built.mix.probe(s);
    }
    expect(built.faults.get('o')).toMatchObject({ first: 'w' });
    expect(built.faults.get('o')?.count).toBeGreaterThan(0);
    expect(built.faults.get('s')).toMatchObject({ first: 'f' });
    expect(built.faults.get(fitFaultKey('s', 1))).toMatchObject({ first: 'f' });
    expect(built.faults.has(fitFaultKey('s', 0))).toBe(false);
  });

  it('a name is unique across voices and groups', () => {
    const built = compile(
      comp([once('a', { name: 'x', owner: 'g' }), once('b')], [group({ id: 'g', name: 'x' })]),
      subjects,
    );
    expect(built.errors).toEqual([
      { voice: 'a', field: 'name', error: 'a group is named "x"', line: null },
    ]);
  });

  it("every solo mix holds every group, so a solo keeps the full mix's timing and fit", () => {
    const groups = [
      group({ id: 'g', start: 100, rate: 2, fade: { in: 300 } }),
      group({ id: 's', kind: 'span', owner: 'g', span: { duration: 500 } }),
    ];
    const a = once('a', { owner: 's' });
    const b = once('b', { owner: 's' });
    const built = compile(comp([a, b], groups), subjects, { solos: true });
    expect(built.errors).toEqual([]);
    for (const id of ['a', 'b'])
      expect([...(built.soloVoices.get(id)?.groupHandles.keys() ?? [])]).toEqual(['g', 's']);
    const silent = compile(comp([a, { ...b, weight: 0 }], groups), subjects).mix;
    same(built.solos.get('a') as Mix<Subject, Mixed>, silent);
  });
});
