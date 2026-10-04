import type { Composition, Voice } from '@pg/blits/composition';
import { applyEdit, clipsOf } from '@pg/blits/score';
import { subjectsOf } from '@pg/blits/stage';
import type { Clip, ClipEdit } from '@pg/widgets/ScoreLanes';
import { hatchOf } from '@pg/widgets/ScoreLanes/drag';
import { describe, expect, it } from 'vitest';

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
    v({ id: 'a', stagger: { code: '(s) => s.col * 100' }, hold: 'after', locus: 'g' }),
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
      holdBefore: false,
      holdAfter: true,
      group: 'g',
      locked: false,
    });
    expect(clips[1]).toMatchObject({ passes: Number.POSITIVE_INFINITY, locked: true });
    expect(clips[2]).toMatchObject({ pass: 0, label: 'c · spring', spread: 0 });
    expect(clips[3]).toMatchObject({ passes: 1, fadeIn: 0, fadeOut: 0, locked: false });
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
  it('writes a hatch as hold, and none removes it', () => {
    expect(at(applyEdit(c, { clip: 'b', kind: 'hatch', hatch: 'both' }), 'b')?.hold).toBe('both');
    expect(at(applyEdit(c, { clip: 'a', kind: 'hatch', hatch: null }), 'a')).not.toHaveProperty(
      'hold',
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
    expect(cc).toMatchObject({ holdBefore: true, holdAfter: false });
    expect(cc?.group).toBeDefined();
    expect(dd).toMatchObject({ fadeIn: 30 });
  });
});
