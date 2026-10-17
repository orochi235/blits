import { bothOf } from '@pg/blits/both';
import type { Composition } from '@pg/blits/composition';
import { flowOf } from '@pg/blits/flow';
import { PRESETS } from '@pg/blits/presets';
import anchors from '@pg/blits/presets/anchors';
import { timingOf } from '@pg/blits/timing';
import { describe, expect, it } from 'vitest';
import { comp, group, voice } from './helpers';

const keys = { kind: 'keys' as const, period: 500, stops: [{ at: 0, delta: { glow: 1 } }] };
const both = (c: Composition) => bothOf(flowOf(c), timingOf(c));

describe('bothOf', () => {
  it('holds every node of the flow and of the timing once, less groups drawn as boxes', () => {
    for (const { name, comp: c } of PRESETS) {
      const t = timingOf(c);
      const boxed = new Set(t.boxes.map((b) => b.id));
      const want = new Set(
        [...flowOf(c).nodes, ...t.nodes].map((n) => n.id).filter((id) => !boxed.has(id)),
      );
      const ids = both(c).nodes.map((n) => n.id);
      expect(new Set(ids), name).toEqual(want);
      expect(ids.length, name).toBe(want.size);
    }
  });

  it('gives a voice both details, the flow first', () => {
    const c = comp([voice({ id: 'a', patch: keys, start: 300 })]);
    expect(both(c).nodes.find((n) => n.id === 'voice:a')?.detail).toBe(
      'keys · 500 ms · loop · w 1\nat 300 ms',
    );
  });

  it('marks every timing edge and keeps its ids apart from the flow edges', () => {
    const b = both(anchors);
    const timed = b.edges.filter((e) => e.timing);
    expect(timed.length).toBe(timingOf(anchors).edges.length);
    expect(timed.every((e) => e.id.startsWith('t:'))).toBe(true);
    expect(new Set(b.edges.map((e) => e.id)).size).toBe(b.edges.length);
  });

  it('boxes an owner in place of its edges to what it holds, keeping its weight edge', () => {
    const c = {
      ...comp(
        [voice({ id: 'a', patch: keys, owner: 'g' })],
        [group({ id: 'g', weight: { code: "level('x')" } })],
      ),
      levels: [{ name: 'x', value: 1, min: 0, max: 1 }],
    };
    const b = both(c);
    expect(b.boxes?.map((x) => x.id)).toEqual(['group:g']);
    expect(b.edges.some((e) => e.from === 'group:g')).toBe(false);
    expect(b.edges).toContainEqual(expect.objectContaining({ from: 'level:x', to: 'group:g' }));
  });

  it('takes the tone a lit timing gives a voice', () => {
    const c = comp([voice({ id: 'a', patch: keys })]);
    const t = timingOf(c);
    const toned = { ...t, nodes: t.nodes.map((n) => ({ ...n, tone: 'playing' as const })) };
    expect(bothOf(flowOf(c), toned).nodes.find((n) => n.id === 'voice:a')?.tone).toBe('playing');
  });
});
