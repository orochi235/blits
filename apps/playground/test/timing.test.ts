import { compile } from '@pg/blits/compile';
import type { Composition } from '@pg/blits/composition';
import { Player } from '@pg/blits/player';
import anchors from '@pg/blits/presets/anchors';
import marksHits from '@pg/blits/presets/marks-hits';
import spanFit from '@pg/blits/presets/span-fit';
import { subjectsOf } from '@pg/blits/stage';
import { lit, liveOf, timingOf } from '@pg/blits/timing';
import { describe, expect, it } from 'vitest';
import { comp, group, voice } from './helpers';

const keys = { kind: 'keys' as const, period: 500, stops: [{ at: 0, delta: { glow: 1 } }] };
const edges = (c: Composition) =>
  timingOf(c).edges.map((e) => [e.from, e.to, e.label ?? ''] as const);

describe('timingOf', () => {
  it('draws a named anchor from the voice it waits on, saying which mark it sets', () => {
    const c = comp([
      voice({ id: 'a', patch: keys }),
      voice({ id: 'b', patch: keys, anchor: { start: { after: 'a', by: 200 } } }),
      voice({ id: 'c', patch: keys, anchor: { out: { with: 'a' } } }),
      voice({ id: 'd', patch: keys, anchor: { in: { of: 'a', mark: 'coast', by: -50 } } }),
      voice({ id: 'e', patch: keys, anchor: { start: { before: 'a', by: 100 } } }),
    ]);
    expect(edges(c)).toEqual([
      ['voice:a', 'voice:b', 'start after +200 ms'],
      ['voice:a', 'voice:c', 'out with'],
      ['voice:a', 'voice:d', 'in its coast −50 ms'],
      ['voice:a', 'voice:e', 'start 100 ms before'],
    ]);
  });

  it('says where an unanchored voice starts, and each fixed time a placement gives', () => {
    const c = comp([
      voice({ id: 'a', patch: keys, start: 300, role: 'x' }),
      voice({ id: 'b', patch: keys, anchor: { start: 1000, end: 3000 } }),
    ]);
    const detail = (id: string) => timingOf(c).nodes.find((n) => n.id === id)?.detail;
    expect(detail('voice:a')).toBe('at 300 ms · role x');
    expect(detail('voice:b')).toBe('at 1000 ms · gone by 3000 ms');
  });

  it('draws a name no voice has as a mark', () => {
    const t = timingOf(marksHits);
    expect(t.nodes.find((n) => n.id === 'mark:beat')).toMatchObject({
      kind: 'mark',
      detail: 'announced at 3000 ms',
    });
    expect(edges(marksHits)).toContainEqual(['mark:beat', 'voice:on-beat', 'start with']);
  });

  it('draws a query as a node fed by every voice it could pick', () => {
    const t = timingOf(marksHits);
    const q = t.nodes.find((n) => n.kind === 'query');
    expect(q?.label).toBe('last tagged lead');
    expect(edges(marksHits)).toEqual(
      expect.arrayContaining([
        ['voice:lead', q?.id, ''],
        [q?.id, 'voice:reply', 'start its coast +100 ms'],
      ]),
    );
  });

  it('draws a join as a node its anchors feed', () => {
    expect(edges(anchors)).toEqual(
      expect.arrayContaining([
        ['voice:intro', 'join:both:start', 'after'],
        ['mark:beat', 'join:both:start', 'with'],
        ['join:both:start', 'voice:both', 'start'],
        ['voice:both', 'group:pair', 'start after'],
        ['group:pair', 'voice:outro', 'start its end +200 ms'],
      ]),
    );
  });

  it('boxes a group around what it holds, and nests a group in its owner', () => {
    const c = comp(
      [voice({ id: 'a', patch: keys, owner: 'in' }), voice({ id: 'b', patch: keys, owner: 'out' })],
      [group({ id: 'out' }), group({ id: 'in', owner: 'out' }), group({ id: 'bare' })],
    );
    const t = timingOf(c);
    expect(t.boxes.map((b) => [b.id, b.members])).toEqual([
      ['group:out', ['group:in', 'voice:b']],
      ['group:in', ['voice:a']],
    ]);
    expect(t.nodes.find((n) => n.id === 'group:bare')).toMatchObject({ kind: 'group' });
  });

  it("chains a queue span's children, and leaves a together span's alone", () => {
    expect(edges(spanFit)).toEqual([
      ['voice:grow', 'voice:spin', 'then'],
      ['voice:spin', 'voice:flash', 'then'],
      ['voice:flash', 'voice:tint', 'then'],
    ]);
    const span = spanFit.groups?.[0];
    if (!span) throw new Error('no span');
    const together = {
      ...spanFit,
      groups: [{ ...span, span: { ...span.span, order: 'together' as const } }],
    };
    expect(edges(together)).toEqual([]);
  });
});

describe('lit', () => {
  const subjects = subjectsOf(anchors.stage);
  const at = (ms: number) => {
    const p = new Player(() => compile(anchors, subjects), subjects, { levels: anchors.levels });
    p.seek(ms);
    return lit(timingOf(anchors), liveOf(p.built, p.host));
  };
  const tone = (ms: number, id: string) => {
    const f = at(ms);
    return (f.nodes.find((n) => n.id === id) ?? f.boxes?.find((b) => b.id === id))?.tone;
  };
  const met = (ms: number, from: string, to: string) =>
    at(ms).edges.find((e) => e.from === from && e.to === to)?.met;

  it('tones a voice by its state', () => {
    expect(tone(100, 'voice:intro')).toBe('waiting');
    expect(tone(600, 'voice:intro')).toBe('playing');
    expect(tone(1500, 'voice:intro')).toBe('done');
  });

  it('meets an all only once every anchor in it has passed', () => {
    expect(met(1500, 'voice:intro', 'join:both:start')).toBe(true);
    expect(met(1500, 'mark:beat', 'join:both:start')).toBe(false);
    expect(met(1500, 'join:both:start', 'voice:both')).toBe(false);
    expect(tone(1500, 'voice:both')).toBe('waiting');
    expect(met(2100, 'mark:beat', 'join:both:start')).toBe(true);
    expect(met(2100, 'join:both:start', 'voice:both')).toBe(true);
  });

  it('meets an any on its first anchor', () => {
    expect(tone(700, 'voice:either')).toBe('waiting');
    expect(tone(900, 'voice:either')).toBe('playing');
    expect(met(900, 'voice:intro', 'join:either:start')).toBe(false);
  });

  it('meets a mark placed inside a voice once the voice has reached it', () => {
    const c = comp([
      voice({ id: 'a', patch: keys, loop: false, marks: { drop: 300 } }),
      voice({ id: 'b', patch: keys, anchor: { start: { all: [{ of: 'a', mark: 'drop' }] } } }),
    ]);
    const subs = subjectsOf(c.stage);
    const drop = (ms: number) => {
      const p = new Player(() => compile(c, subs), subs, { levels: c.levels });
      p.seek(ms);
      const f = lit(timingOf(c), liveOf(p.built, p.host));
      return f.edges.find((e) => e.from === 'voice:a' && e.to === 'join:b:start');
    };
    expect(drop(200)?.label).toBe('its drop');
    expect(drop(200)?.met).toBe(false);
    expect(drop(400)?.met).toBe(true);
  });

  it("tones a span's box, and meets each child's turn as it starts", () => {
    expect(tone(2500, 'group:pair')).toBe('waiting');
    expect(tone(3000, 'group:pair')).toBe('playing');
    expect(met(3000, 'voice:one', 'voice:two')).toBe(false);
    expect(met(3500, 'voice:one', 'voice:two')).toBe(true);
  });
});
