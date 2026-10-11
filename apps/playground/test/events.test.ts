import { tagsOf } from '@pg/app/MarksFields';
import { PLACEMENTS, parsePlacement, placementFault } from '@pg/blits/anchor';
import { compile } from '@pg/blits/compile';
import type { Composition, PatchSource } from '@pg/blits/composition';
import { load } from '@pg/blits/load';
import { placedOf } from '@pg/blits/placed';
import { Player } from '@pg/blits/player';
import { PRESETS } from '@pg/blits/presets';
import { clipsOf } from '@pg/blits/score';
import { subjectsOf } from '@pg/blits/stage';
import { tickTimes } from '@pg/widgets/ScoreLanes/Marks';
import { describe, expect, it } from 'vitest';
import { comp, subjects, voice } from './helpers';

const KEYS: PatchSource = {
  kind: 'keys',
  period: 400,
  stops: [
    { at: 0, delta: { scale: 1 } },
    { at: 1, delta: { scale: 2 } },
  ],
};
const once = (id: string, over = {}) => voice({ id, patch: KEYS, loop: false, ...over });

describe('a placement typed as JSON', () => {
  it('takes every anchor blits has', () => {
    for (const make of Object.values(PLACEMENTS)) expect(placementFault(make('a'))).toBeNull();
    expect(parsePlacement('')).toEqual({});
    expect(
      parsePlacement('{"in": {"of": {"tag": "x", "resolver": "next"}, "mark": "coast"}}'),
    ).toEqual({ placement: { in: { of: { tag: 'x', resolver: 'next' }, mark: 'coast' } } });
  });

  it.each([
    ['{"start": 1, "in": 2}', 'one of start and in'],
    ['{"begin": 1}', '"begin"'],
    ['{"start": {"of": "a", "mark": "middle"}}', 'mark is one of'],
    ['{"start": {"after": "a", "with": "b"}}', 'takes one of'],
    ['{"start": {"after": {"tagged": "x"}}}', '"tagged"'],
    ['{"start": {"all": []}}', 'a list of anchors'],
    ['{"start": {"after": "a", "by": "soon"}}', 'by is a number'],
    ['{start: 1}', 'JSON'],
  ])('refuses %s', (text, why) => {
    const r = parsePlacement(text);
    expect('error' in r && r.error).toContain(why);
  });
});

describe('marks, tags, and announced marks', () => {
  it('places a voice by a tag query, a mark, and an announced mark', () => {
    const c: Composition = {
      ...comp([
        once('a', { start: 100, tags: ['lead'] }),
        once('b', { anchor: { start: { of: { tag: 'lead' }, mark: 'coast', by: 50 } } }),
        once('c', { anchor: { start: { with: 'beat' } } }),
        once('d', { anchor: { start: { all: [{ after: 'a' }, { with: 'beat' }] } } }),
      ]),
      announced: [{ name: 'beat', at: 900 }],
    };
    const built = compile(c, subjects);
    expect(built.errors).toEqual([]);
    const placed = placedOf(built);
    expect(placed.get('b')?.start).toBe(550);
    expect(placed.get('c')?.start).toBe(900);
    expect(placed.get('d')?.start).toBe(900);
    const marks = built.mix.marks(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
    expect(marks.find((m) => m.name === 'beat' && m.voice === undefined)?.timestamp).toBe(900);
    expect(clipsOf(c, subjects).marks).toEqual([{ at: 900, label: 'beat' }]);
  });

  it('keeps a voice in its own score from a bare name in another', () => {
    const c = comp([
      once('a', { score: 'one' }),
      once('b', { score: 'two', anchor: { start: { after: 'a' } } }),
      once('c', { score: 'two', anchor: { start: { after: { score: 'one', name: 'a' } } } }),
    ]);
    const built = compile(c, subjects);
    expect(built.handles.get('b')?.state).toBe('pending');
    expect(placedOf(built).get('b')).toBeUndefined();
    expect(placedOf(built).get('c')?.start).toBe(400);
  });

  it('reads tags from text', () => {
    expect(tagsOf(' lead, sound,,lead ')).toEqual(['lead', 'sound']);
    expect(tagsOf(' , ')).toBeUndefined();
  });
});

describe('the event log', () => {
  const marksHits = PRESETS.find((x) => x.name === 'marks and hits')?.comp as Composition;
  const play = (tag?: string) => {
    const subs = subjectsOf(marksHits.stage);
    const p = new Player(() => compile(marksHits, subs, { solos: true }), subs, {
      levels: marksHits.levels,
    });
    if (tag) {
      p.events.tag = tag;
      p.rebuild();
    }
    p.seek(2600);
    return p;
  };

  it('books each hit once a pass, and the marks, ahead of time', () => {
    const p = play();
    const hits = p.events.booked.filter((b) => 'hit' in b.item && !b.stopped);
    expect(hits.map((b) => 'hit' in b.item && [b.item.event, b.item.pass])).toEqual([
      ['tick', 0],
      ['tock', 0],
      ['tick', 1],
      ['tock', 1],
    ]);
    expect(hits.map((b) => Math.round(b.when))).toEqual([200, 600, 1000, 1400]);
    expect(p.events.booked.some((b) => !('hit' in b.item) && b.item.mark === 'coast')).toBe(true);
    expect(p.built.errors).toEqual([]);
  });

  it('drains what a patch sent, and by tag only that tag', () => {
    const p = play();
    expect(p.events.sent.map((e) => e.event)).toEqual([{ pass: 0 }, { pass: 1 }, { pass: 2 }]);
    expect(p.events.sent.every((e) => e.tags.includes('count'))).toBe(true);
    const sound = play('sound');
    expect(sound.events.sent).toEqual([]);
    expect(sound.events.booked.every((b) => b.item.tags.includes('sound'))).toBe(true);
    expect(sound.events.booked.length).toBeGreaterThan(0);
  });

  it('starts over on a scrub back by replay', () => {
    const p = play();
    p.seek(100);
    expect(p.events.sent.map((e) => e.event)).toEqual([{ pass: 0 }]);
  });
});

describe('hits and marks elsewhere', () => {
  it('draws a tick per hit per pass', () => {
    const c = comp([
      voice({ id: 'a', patch: KEYS, loop: 2, rate: 2, hits: [{ at: 100, event: 'x' }] }),
    ]);
    const [clip] = clipsOf(c, subjects).clips;
    expect(clip?.ticks).toEqual([50]);
    expect(clip && tickTimes(clip, 2000)).toEqual([50, 250]);
  });

  it('loads them, and refuses a placement blits would not take', () => {
    const c: Composition = {
      ...comp([once('a', { tags: ['x'], score: 's', hits: [{ at: 0, event: 'e' }] })]),
      announced: [{ name: 'beat', at: 10 }],
    };
    expect(load(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(load({ ...c, announced: [{ name: 'beat' }] })).toBeNull();
    expect(load(comp([once('a', { anchor: { start: { sometime: 'a' } } as never })]))).toBeNull();
    expect(load(comp([once('a', { hits: [{ at: -1, event: 'e' }] })]))).toBeNull();
  });
});
