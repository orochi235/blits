import { describe, expect, it } from 'vitest';
import type { Channel, OutlineVoice } from '../src/index.js';
import { color, kit, last, level, max, mix, patch, sum, vec } from '../src/index.js';

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
      lane: { on: false, why: 'new' },
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

interface LanePose {
  a: number;
  b: number;
  v: [number, number];
  t: number[];
  odd: number;
}
// Not a stock channel, so never laned.
const odd: Channel<number> = {
  rest: 0,
  merge: (x, y) => x + y,
  scale: (x, w) => x * w,
  lerp: (x, y, u) => x + (y - x) * u,
};
const LK = kit<LanePose>({ a: sum(), b: sum(), v: vec(2, sum()), t: color(last()), odd });
const writes = (...w: (keyof LanePose)[]) => patch<Row, LanePose>(1000, () => ({}), { writes: w });
const kept = (...w: (keyof LanePose)[]) =>
  patch<Row, LanePose, number>(1000, () => ({}), { writes: w, state: () => 0 });

type LaneMix = ReturnType<typeof mix<Row, LanePose>>;

/** Cues on a fresh mix, then syncs and probes one subject so the lanes decide. */
function laneOf(cue: (m: LaneMix) => void, opts: { lanes?: boolean } = {}) {
  const m = mix<Row, LanePose>(LK, opts);
  cue(m);
  m.sync(0);
  m.probe({ id: 'x' });
  return (name: string) => byName(m.describe().voices, name).lane;
}

describe('describe: whether a voice runs on a lane', () => {
  it('says a voice that qualifies is on its lane', () => {
    const lane = laneOf((m) => m.cue({ name: 'on', patch: writes('a') }));
    expect(lane('on')).toEqual({ on: true });
  });

  it('says new for a voice the lanes have not met since it was cued', () => {
    const m = mix<Row, LanePose>(LK);
    m.cue({ name: 'fresh', patch: writes('a') });
    expect(byName(m.describe().voices, 'fresh').lane).toEqual({ on: false, why: 'new' });
  });

  it('says mix for every voice of a mix with lanes off', () => {
    const lane = laneOf((m) => m.cue({ name: 'v', patch: writes('a') }), { lanes: false });
    expect(lane('v')).toEqual({ on: false, why: 'mix' });
  });

  it("keeps a level()'s voice on its lane, and a signal no input() made off it", () => {
    const flagged = Object.assign(() => 1, { input: true as const });
    const lane = laneOf((m) => {
      m.cue({ name: 'level', patch: writes('a'), weight: level(1) });
      m.cue({ name: 'plain', patch: writes('b'), weight: () => 1 });
      m.cue({ name: 'flagged', patch: writes('t'), weight: flagged });
    });
    expect(lane('level')).toEqual({ on: true });
    expect(lane('plain')).toEqual({ on: true });
    expect(lane('flagged')).toEqual({ on: false, why: 'input' });
  });

  it('says last for each member of a blend writing a last channel', () => {
    const m = mix<Row, LanePose>(LK);
    m.blend([writes('t'), writes('t')], level(0), { name: 'bl' });
    m.sync(0);
    m.probe({ id: 'x' });
    const lanes = m
      .describe()
      .voices.filter((v) => v.name === 'bl')
      .map((v) => v.lane);
    expect(lanes).toEqual([
      { on: false, why: 'last' },
      { on: false, why: 'last' },
    ]);
  });

  it('says state for a patch keeping state, and shared for a voice on a channel it closed', () => {
    const lane = laneOf((m) => {
      m.cue({ name: 'kept', patch: kept('a') });
      m.cue({ name: 'beside', patch: writes('a', 'b') });
    });
    expect(lane('kept')).toEqual({ on: false, why: 'state' });
    expect(lane('beside')).toEqual({ on: false, why: 'shared' });
  });

  it('says kind for a voice writing a channel no lane folds', () => {
    const lane = laneOf((m) => m.cue({ name: 'odd', patch: writes('a', 'odd') }));
    expect(lane('odd')).toEqual({ on: false, why: 'kind' });
  });

  it('says role for a member kept off by another, which gives its own reason', () => {
    const lane = laneOf((m) => {
      m.cue({ name: 'kept', role: 'r', patch: kept('a') });
      m.cue({ name: 'other', role: 'r', patch: writes('b') });
    });
    expect(lane('kept')).toEqual({ on: false, why: 'state' });
    expect(lane('other')).toEqual({ on: false, why: 'role' });
    const closed = laneOf((m) => {
      m.cue({ name: 'odd', role: 'r', patch: writes('odd') });
      m.cue({ name: 'other', role: 'r', patch: writes('b') });
    });
    expect(closed('odd')).toEqual({ on: false, why: 'kind' });
    expect(closed('other')).toEqual({ on: false, why: 'role' });
  });

  it('says none for an owner, and owner for a voice under one weighted by a signal', () => {
    const lane = laneOf((m) => {
      const o = m.owns({ name: 'own', weight: level(1) });
      m.cue({ name: 'kid', patch: writes('a'), owner: o });
    });
    expect(lane('own')).toEqual({ on: false, why: 'none' });
    expect(lane('kid')).toEqual({ on: false, why: 'owner' });
  });

  it('says calls for a lone fn voice on a vec, which a fill would walk twice', () => {
    const lane = laneOf((m) => m.cue({ name: 'fn', patch: writes('v') }));
    expect(lane('fn')).toEqual({ on: false, why: 'calls' });
  });

  it('says wait for a voice frozen before a start still to come', () => {
    const lane = laneOf((m) =>
      m.cue({ name: 'later', patch: writes('a'), start: 500, freeze: 'before' }),
    );
    expect(lane('later')).toEqual({ on: false, why: 'wait' });
  });

  it('takes up voices cued between probes', () => {
    const m = mix<Row, LanePose>(LK);
    m.cue({ name: 'first', patch: writes('a') });
    m.sync(0);
    m.probe({ id: 'x' });
    m.cue({ name: 'kept', patch: kept('b') });
    m.cue({ name: 'more', patch: writes('a') });
    m.sync(16);
    m.probe({ id: 'x' });
    m.cue({ name: 'odd', patch: writes('odd') });
    m.sync(32);
    m.probe({ id: 'x' });
    const { voices } = m.describe();
    expect(byName(voices, 'kept').lane).toEqual({ on: false, why: 'state' });
    expect(byName(voices, 'more').lane).toEqual({ on: true });
    expect(byName(voices, 'odd').lane).toEqual({ on: false, why: 'kind' });
  });

  it('reports a voice moving off its lane as of the last probe', () => {
    const m = mix<Row, LanePose>(LK);
    m.cue({ name: 'lead', patch: writes('a') });
    m.sync(0);
    m.probe({ id: 'x' });
    expect(byName(m.describe().voices, 'lead').lane).toEqual({ on: true });
    m.cue({ name: 'kept', patch: kept('a') });
    m.sync(16);
    expect(byName(m.describe().voices, 'lead').lane).toEqual({ on: true });
    m.probe({ id: 'x' });
    expect(byName(m.describe().voices, 'lead').lane).toEqual({ on: false, why: 'shared' });
  });
});
