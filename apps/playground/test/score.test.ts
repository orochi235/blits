import { compile } from '@pg/blits/compile';
import type { Composition, PatchSource, Voice } from '@pg/blits/composition';
import { applyEdit, clipsOf } from '@pg/blits/score';
import { subjectsOf } from '@pg/blits/stage';
import { type Clip, type ClipEdit, hatchOf } from '@pg/widgets/ScoreLanes';
import { clipEnd } from '@pg/widgets/ScoreLanes/geometry';
import { describe, expect, it } from 'vitest';
import { comp, group, voice } from './helpers';

const v = (x: Partial<Voice> & Pick<Voice, 'id'>): Voice => ({
  name: x.id,
  hue: 10,
  start: 0,
  rate: 1,
  loop: 2,
  weight: 1,
  fade: { in: 100, out: 50 },
  patch: { kind: 'keys', period: 400, stops: [{ at: 0, delta: { glow: 1 } }] },
  ...x,
});
const c: Composition = {
  version: 1,
  title: 't',
  stage: { kind: 'dots', cols: 4, rows: 1 },
  length: 4000,
  levels: [],
  voices: [
    v({ id: 'a', stagger: { code: '(s) => s.col * 100' }, freeze: 'after', locus: 'g' }),
    v({ id: 'b', loop: true, anchor: { start: { after: 'a' } } }),
    v({ id: 'c', patch: { kind: 'spring', channel: 'scale', opts: { to: 2 } }, loop: true }),
    v({ id: 'd', loop: false, fade: {}, anchor: { end: { of: 'c', mark: 'in', by: 20 } } }),
  ],
};
const subjects = subjectsOf(c.stage);
const at = (d: Composition, id: string) => d.voices.find((x) => x.id === id);

describe('clipsOf', () => {
  it('maps a voice to a clip', () => {
    const { clips } = clipsOf(c, subjects);
    expect(clips[0]).toEqual({
      id: 'a',
      lane: 0,
      label: 'a · keys',
      hue: 10,
      start: 0,
      pass: 400,
      passes: 2,
      fadeIn: 100,
      fadeOut: 50,
      spread: 300,
      freezeBefore: false,
      freezeAfter: true,
      group: 'g',
      locked: false,
    });
    expect(clips[1]).toMatchObject({ passes: Number.POSITIVE_INFINITY, locked: true });
    expect(clips[2]).toMatchObject({ pass: 0, label: 'c · spring', spread: 0 });
    expect(clips[3]).toMatchObject({ passes: 1, fadeIn: 0, fadeOut: 0, locked: false });
  });
  it('a spread starts at the smallest stagger', () => {
    const d = { ...c, voices: [v({ id: 'x', stagger: { code: '(s) => 100 + s.col * 50' } })] };
    expect(clipsOf(d, subjects).clips[0]).toMatchObject({ spreadAt: 100, spread: 150 });
    expect(clipsOf(c, subjects).clips[0]).not.toHaveProperty('spreadAt');
  });
  it('an anchor naming its own voice links to another voice of that name, or none', () => {
    const self = v({ id: 'x', name: 'n', anchor: { start: { after: 'n' } } });
    expect(clipsOf({ ...c, voices: [self] }, subjects).links).toEqual([]);
    const twin = v({ id: 'y', name: 'n' });
    expect(clipsOf({ ...c, voices: [self, twin] }, subjects).links).toEqual([
      { from: { clip: 'x', edge: 'start' }, to: { clip: 'y', edge: 'end' } },
    ]);
  });
  it('a stagger that fails to compile spreads nothing', () => {
    const d = { ...c, voices: [v({ id: 'x', stagger: { code: '(s) =>' } })] };
    expect(clipsOf(d, subjects).clips[0]?.spread).toBe(0);
  });
  it('draws anchors as links, from the start or end they place', () => {
    expect(clipsOf(c, subjects).links).toEqual([
      { from: { clip: 'b', edge: 'start' }, to: { clip: 'a', edge: 'end' } },
      { from: { clip: 'd', edge: 'end' }, to: { clip: 'c', edge: 'start' } },
    ]);
  });
  it('an anchor naming a missing voice draws no link', () => {
    const d = { ...c, voices: [v({ id: 'x', anchor: { start: { after: 'nobody' } } })] };
    expect(clipsOf(d, subjects).links).toEqual([]);
  });
  it('a join anchor, all or any, draws no link', () => {
    const d = {
      ...c,
      voices: [
        v({ id: 'a' }),
        v({ id: 'b' }),
        v({ id: 'x', anchor: { start: { all: [{ after: 'a' }, { after: 'b' }] } } }),
      ],
    };
    expect(clipsOf(d, subjects).links).toEqual([]);
  });
});

describe('a clip’s rate', () => {
  it('divides its length', () => {
    const d = {
      ...c,
      voices: [v({ id: 'x', start: 100, rate: 2, patch: { ...KEYS, period: 500 } })],
    };
    expect(clipEnd(clipsOf(d, subjects).clips[0] as Clip)).toBe(600);
  });
  it('at 0 or below, never ends and has no passes', () => {
    for (const rate of [0, -1]) {
      const d = { ...c, voices: [v({ id: 'x', rate })] };
      expect(clipsOf(d, subjects).clips[0]).toMatchObject({
        pass: 0,
        passes: Number.POSITIVE_INFINITY,
      });
    }
  });
});

const KEYS: Extract<PatchSource, { kind: 'keys' }> = {
  kind: 'keys',
  period: 400,
  stops: [{ at: 0, delta: { glow: 1 } }],
};
const once = (id: string, over: Partial<Voice> = {}) =>
  voice({ id, patch: KEYS, loop: false, ...over });

describe('groups on the score', () => {
  // A span of 700 ms under an owner at rate 2 holding three 400 ms voices in a queue: `b` may run
  // twice as fast and is, `c` is ballast and is shed.
  const g = comp(
    [
      once('a', { owner: 's' }),
      once('b', { owner: 's', hints: { faster: 2 } }),
      once('c', { owner: 's', hints: { ballast: true } }),
      once('x', { start: 300 }),
    ],
    [
      group({ id: 'o', start: 200, rate: 2 }),
      group({ id: 's', kind: 'span', owner: 'o', span: { duration: 700 } }),
    ],
  );
  const built = compile(g, subjects);
  const laid = clipsOf(g, subjects, { built });
  const clip = (id: string) => laid.clips.find((x) => x.id === id);

  it('lays rows out depth-first, a header above its members', () => {
    expect(laid.headers.map((h) => [h.id, h.lane, h.depth])).toEqual([
      ['o', 0, 0],
      ['s', 1, 1],
    ]);
    expect(laid.clips.map((x) => [x.id, x.lane, x.depth])).toEqual([
      ['a', 2, 2],
      ['b', 3, 2],
      ['c', 4, 2],
      ['x', 5, undefined],
    ]);
  });
  it('places a span’s children where blits put them, each after the last, locked', () => {
    expect(clip('a')).toMatchObject({ start: 200, pass: 200, passes: 1, locked: true });
    expect(clip('b')).toMatchObject({ start: 400, pass: 100, factor: 2, locked: true });
    expect(clip('a')).not.toHaveProperty('factor');
  });
  it('shows a shed child skipped, at its natural length', () => {
    expect(clip('c')).toMatchObject({ start: 500, pass: 200, skipped: true });
    expect(clip('b')).not.toHaveProperty('skipped');
  });
  it('gives a span’s header its extent, budget and fit', () => {
    const [o, s] = laid.headers;
    expect(s).toMatchObject({ label: 's · span', start: 200, end: 550, budget: 550, fell: false });
    expect(s).not.toHaveProperty('over');
    expect(o).toMatchObject({ label: 'o · owner', start: 200, end: 550 });
    expect(o).not.toHaveProperty('budget');
  });
  it('shows how far a span runs over its budget', () => {
    const tight = {
      ...g,
      groups: g.groups?.map((x) =>
        x.id === 's' ? { ...x, span: { duration: 300, fit: [{ kind: 'overrun' as const }] } } : x,
      ),
    };
    const s = clipsOf(tight, subjects, { built: compile(tight, subjects) }).headers[1];
    expect(s?.budget).toBe(350);
    expect(s?.over).toBeGreaterThan(0);
  });
  it('without a build, places by the composition’s own fields', () => {
    const plain = clipsOf(g, subjects);
    expect(plain.clips.find((x) => x.id === 'b')).toMatchObject({ start: 0, locked: true });
    expect(plain.headers[1]).toMatchObject({
      start: 0,
      end: Number.POSITIVE_INFINITY,
      budget: 700,
    });
  });
  it('a folded group hides everything under it', () => {
    const folded = clipsOf(g, subjects, { built, folded: new Set(['s']) });
    expect(folded.headers.map((h) => [h.id, h.folded])).toEqual([
      ['o', false],
      ['s', true],
    ]);
    expect(folded.clips.map((x) => [x.id, x.lane])).toEqual([['x', 2]]);
    const outer = clipsOf(g, subjects, { folded: new Set(['o']) });
    expect(outer.headers.map((h) => h.id)).toEqual(['o']);
    expect(outer.clips.map((x) => x.id)).toEqual(['x']);
  });
});

describe('applyEdit', () => {
  it('writes passes as loop, a move as start, fades as fade', () => {
    let d = applyEdit(c, { clip: 'a', kind: 'passes', passes: 3 });
    d = applyEdit(d, { clip: 'a', kind: 'move', start: 250 });
    d = applyEdit(d, { clip: 'a', kind: 'fadeOut', ms: 80 });
    expect(d.voices[0]).toMatchObject({ loop: 3, start: 250, fade: { in: 100, out: 80 } });
    expect(c.voices[0]?.loop).toBe(2);
  });
  it('writes a link as an anchor on the voice it starts from', () => {
    const d = applyEdit(c, {
      clip: 'c',
      kind: 'link',
      link: { from: { clip: 'c', edge: 'start' }, to: { clip: 'a', edge: 'start' } },
    });
    expect(at(d, 'c')?.anchor).toEqual({ start: { with: 'a' } });
  });
  it('a link from an end edge anchors the end, replacing an out anchor', () => {
    const e = applyEdit(
      { ...c, voices: [...c.voices, v({ id: 'e', anchor: { out: 5 } })] },
      {
        clip: 'e',
        kind: 'link',
        link: { from: { clip: 'e', edge: 'end' }, to: { clip: 'b', edge: 'end' } },
      },
    );
    expect(at(e, 'e')?.anchor).toEqual({ end: { after: 'b' } });
  });
  it('writes a hatch as freeze, and none removes it', () => {
    expect(at(applyEdit(c, { clip: 'b', kind: 'hatch', hatch: 'both' }), 'b')?.freeze).toBe('both');
    expect(at(applyEdit(c, { clip: 'a', kind: 'hatch', hatch: null }), 'a')).not.toHaveProperty(
      'freeze',
    );
  });
  it('joining a grouped clip takes its locus', () => {
    const d = applyEdit(c, { clip: 'c', kind: 'group', with: 'a' });
    expect(at(d, 'c')?.locus).toBe('g');
    expect(at(d, 'a')?.locus).toBe('g');
  });
  it('joining an ungrouped clip gives both a fresh locus', () => {
    const d = applyEdit(
      { ...c, voices: [...c.voices, v({ id: 'e', locus: 'group 1' })] },
      { clip: 'b', kind: 'group', with: 'c' },
    );
    expect(at(d, 'b')?.locus).toBe('group 2');
    expect(at(d, 'c')?.locus).toBe('group 2');
  });
  it('leaving a group removes the locus', () => {
    expect(at(applyEdit(c, { clip: 'a', kind: 'group', with: null }), 'a')).not.toHaveProperty(
      'locus',
    );
  });
  it('a group left with one voice is dissolved', () => {
    const pair = { ...c, voices: [...c.voices, v({ id: 'e', locus: 'g' })] };
    const left = applyEdit(pair, { clip: 'e', kind: 'group', with: null });
    expect(left.voices.filter((x) => x.locus !== undefined)).toEqual([]);
    const moved = applyEdit(pair, { clip: 'e', kind: 'group', with: 'b' });
    expect(at(moved, 'a')).not.toHaveProperty('locus');
    expect([at(moved, 'e')?.locus, at(moved, 'b')?.locus]).toEqual(['group 1', 'group 1']);
    const trio = { ...pair, voices: [...pair.voices, v({ id: 'f', locus: 'g' })] };
    expect(at(applyEdit(trio, { clip: 'e', kind: 'group', with: null }), 'a')?.locus).toBe('g');
  });
  it('an edit naming no voice changes nothing', () => {
    expect(applyEdit(c, { clip: 'nobody', kind: 'move', start: 5 })).toBe(c);
    expect(applyEdit(c, { clip: 'a', kind: 'group', with: 'nobody' })).toBe(c);
  });
});

/** Every edit a clip can report, carrying the values it already shows. */
function sameEdits(clip: Clip, all: ReturnType<typeof clipsOf>): ClipEdit[] {
  const edits: ClipEdit[] = [
    { clip: clip.id, kind: 'move', start: clip.start },
    { clip: clip.id, kind: 'passes', passes: clip.passes },
    { clip: clip.id, kind: 'fadeIn', ms: clip.fadeIn },
    { clip: clip.id, kind: 'fadeOut', ms: clip.fadeOut },
    { clip: clip.id, kind: 'hatch', hatch: hatchOf(clip) },
  ];
  const mate = all.clips.find(
    (o) => o.id !== clip.id && o.group !== undefined && o.group === clip.group,
  );
  if (mate) edits.push({ clip: clip.id, kind: 'group', with: mate.id });
  for (const link of all.links)
    if (link.from.clip === clip.id) edits.push({ clip: clip.id, kind: 'link', link });
  return edits;
}

describe('voice → clip → edit → voice', () => {
  const grouped = { ...c, voices: [...c.voices, v({ id: 'e', locus: 'g' })] };
  it('an edit carrying a clip’s own values leaves its voice unchanged', () => {
    const all = clipsOf(grouped, subjects);
    for (const clip of all.clips)
      for (const edit of sameEdits(clip, all))
        expect(applyEdit(grouped, edit), `${clip.id} ${edit.kind}`).toBe(grouped);
  });
  it('an edited voice reads back as the edited clip', () => {
    const edits: ClipEdit[] = [
      { clip: 'a', kind: 'move', start: 120 },
      { clip: 'b', kind: 'passes', passes: 4 },
      { clip: 'd', kind: 'fadeIn', ms: 30 },
      { clip: 'a', kind: 'fadeOut', ms: 10 },
      { clip: 'c', kind: 'hatch', hatch: 'before' },
      { clip: 'c', kind: 'group', with: 'b' },
    ];
    let d = c;
    for (const edit of edits) d = applyEdit(d, edit);
    const [a, b, cc, dd] = clipsOf(d, subjects).clips;
    expect(a).toMatchObject({ start: 120, fadeOut: 10 });
    expect(b).toMatchObject({ passes: 4, group: cc?.group });
    expect(cc).toMatchObject({ freezeBefore: true, freezeAfter: false });
    expect(cc?.group).toBeDefined();
    expect(dd).toMatchObject({ fadeIn: 30 });
  });
});
