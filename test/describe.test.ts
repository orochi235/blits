import { describe, expect, it } from 'vitest';
import type { OutlineVoice } from '../src/index.js';
import { kit, level, max, mix, patch, sum } from '../src/index.js';

interface Pose {
  a: number;
  b: number;
  c: number;
}
const K = kit<Pose>({ a: sum(), b: max(), c: sum() });
type Row = { id: string };

const writing = (...writes: (keyof Pose)[]) => patch<Row, Pose>(100, () => ({}), { writes });

const byName = (voices: readonly OutlineVoice[], name: string) =>
  voices.find((v) => v.name === name) as OutlineVoice;

describe('describe', () => {
  it('lists the kit in kit order, with each channel kind', () => {
    const m = mix<Row, Pose>(K, { name: 'scene' });
    const o = m.describe();
    expect(o.name).toBe('scene');
    expect(o.channels).toEqual([
      { name: 'a', kind: K.a.kind },
      { name: 'b', kind: K.b.kind },
      { name: 'c', kind: K.c.kind },
    ]);
    expect(o.voices).toEqual([]);
  });

  it('lists each voice as voices() does, with what it writes in kit order', () => {
    const m = mix<Row, Pose>(K);
    const h = m.cue({ name: 'lead', patch: writing('c', 'a'), tags: ['x'], score: 's' });
    const [v] = m.describe().voices;
    expect(v).toEqual({
      id: h.id,
      name: 'lead',
      kind: 'voice',
      owner: undefined,
      part: undefined,
      state: 'pending',
      writes: ['a', 'c'],
      role: undefined,
      weight: 1,
      stagger: false,
      target: false,
      score: 's',
      tags: ['x'],
      anchor: undefined,
      marks: undefined,
    });
    expect(m.describe().voices.map((x) => x.id)).toEqual(m.voices().map((x) => x.id));
  });

  it('says what sets a weight and what acts per subject', () => {
    const m = mix<Row, Pose>(K);
    const h = m.cue({ name: 'n', patch: writing('a') });
    h.weight = 0.25;
    m.cue({
      name: 's',
      patch: writing('a'),
      weight: level(1),
      stagger: () => 10,
      target: () => true,
    });
    m.blend([writing('b'), writing('b')], level(0), { name: 'bl' });
    const { voices } = m.describe();
    expect(byName(voices, 'n')).toMatchObject({ weight: 0.25, stagger: false, target: false });
    expect(byName(voices, 's')).toMatchObject({ weight: 'signal', stagger: true, target: true });
    const blended = voices.filter((v) => v.name === 'bl');
    expect(blended.map((v) => v.weight)).toEqual(['blend', 'blend']);
    expect(blended[0]?.role).toBe(blended[1]?.role);
    expect(blended[0]?.role).toBeDefined();
  });

  it('names roles, given by role or by a tag the mix calls a role', () => {
    const m = mix<Row, Pose>(K, { roles: ['look'] });
    m.cue({ name: 'r', patch: writing('a'), role: 'pose' });
    m.cue({ name: 't', patch: writing('a'), tags: ['look'] });
    m.cue({ name: 'none', patch: writing('a') });
    const { voices } = m.describe();
    expect(voices.map((v) => [v.name, v.role])).toEqual([
      ['r', 'pose'],
      ['t', 'look'],
      ['none', undefined],
    ]);
  });

  it('nests owners and spans, each listed before what it holds', () => {
    const m = mix<Row, Pose>(K);
    const outer = m.owns({ name: 'outer' });
    const span = m.span({ name: 'span', owner: outer });
    const kid = m.cue({ name: 'kid', patch: writing('b'), owner: span, loop: 1 });
    const o = m.describe();
    expect(o.voices.map((v) => [v.name, v.kind, v.owner, v.writes])).toEqual([
      ['outer', 'owner', undefined, []],
      ['span', 'span', outer.id, []],
      ['kid', 'voice', span.id, ['b']],
    ]);
    expect(o.voices[2]?.id).toBe(kid.id);
  });

  it('lists an arc with its parts', () => {
    const m = mix<Row, Pose>(K);
    const arc = m.arc({
      name: 'word',
      enter: { name: 'in', patch: writing('a') },
      active: { name: 'hold', patch: writing('b') },
      exit: { name: 'out', patch: writing('c') },
    });
    const { voices } = m.describe();
    expect(voices.map((v) => [v.name, v.kind, v.owner, v.part])).toEqual([
      ['word', 'arc', undefined, undefined],
      ['in', 'voice', arc.id, 'enter'],
      ['hold', 'voice', arc.id, 'active'],
      ['out', 'voice', arc.id, 'exit'],
    ]);
  });

  it('copies anchors and marks, so the outline stays put when the spec is changed', () => {
    const m = mix<Row, Pose>(K);
    m.cue({ name: 'lead', patch: writing('a'), marks: { drop: 40 } });
    const anchor = { start: { of: 'lead', mark: 'drop', by: 5 }, end: 900 };
    m.cue({ name: 'follow', patch: writing('a'), anchor });
    const o = m.describe();
    expect(byName(o.voices, 'lead').marks).toEqual({ drop: 40 });
    const got = byName(o.voices, 'follow').anchor;
    expect(got).toEqual(anchor);
    expect(got).not.toBe(anchor);
    expect(got?.start).not.toBe(anchor.start);
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
  });

  it('leaves out a voice that is done, as voices() does', () => {
    const m = mix<Row, Pose>(K);
    m.cue({ name: 'brief', patch: writing('a'), loop: 1, start: 0 });
    m.cue({ name: 'long', patch: writing('a'), loop: true, start: 0 });
    m.sync(0);
    m.sync(500);
    expect(m.describe().voices.map((v) => v.name)).toEqual(['long']);
  });
});
