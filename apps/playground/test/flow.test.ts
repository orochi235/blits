import type { Composition, Voice } from '@pg/blits/composition';
import { flowOf, foldOf, writesOf } from '@pg/blits/flow';
import { KIT } from '@pg/blits/kit';
import crossfade from '@pg/blits/presets/crossfade';
import pointerGlow from '@pg/blits/presets/pointer-glow';
import staggerWave from '@pg/blits/presets/stagger-wave';
import { describe, expect, it } from 'vitest';

const edges = (c: Composition, faulted?: Set<string>) =>
  flowOf(c, faulted).edges.map((e) => [e.from, e.to, e.label ?? ''] as const);
const node = (c: Composition, id: string) => flowOf(c).nodes.find((n) => n.id === id);

const voice = (over: Partial<Voice>): Voice => ({
  id: 'v',
  name: 'v',
  hue: 0,
  start: 0,
  rate: 1,
  loop: true,
  fade: {},
  weight: 1,
  patch: { kind: 'keys', period: 1000, stops: [{ at: 0, delta: { glow: 1 } }] },
  ...over,
});
const comp = (voices: Voice[], levels: Composition['levels'] = []): Composition => ({
  version: 1,
  title: 't',
  stage: { kind: 'dots', cols: 2, rows: 1 },
  length: 1000,
  levels,
  voices,
});

describe('flowOf', () => {
  it('draws the crossfade preset', () => {
    expect(new Set(flowOf(crossfade).nodes.map((n) => n.id))).toEqual(
      new Set([
        'level:mix',
        'voice:warm',
        'expr:warm:weight',
        'voice:cool',
        'ch:color',
        'ch:scale',
        'pose',
      ]),
    );
    expect(new Set(edges(crossfade))).toEqual(
      new Set([
        ['level:mix', 'expr:warm:weight', ''],
        ['expr:warm:weight', 'voice:warm', 'weight'],
        ['level:mix', 'voice:cool', 'weight'],
        ['voice:warm', 'ch:color', ''],
        ['voice:warm', 'ch:scale', ''],
        ['voice:cool', 'ch:color', ''],
        ['voice:cool', 'ch:scale', ''],
        ['ch:color', 'pose', ''],
        ['ch:scale', 'pose', ''],
      ]),
    );
  });

  it('labels a channel with its rule and the pose with its subjects', () => {
    expect(node(crossfade, 'ch:color')?.detail).toBe(KIT.color.kind);
    expect(node(crossfade, 'pose')?.detail).toBe('× 32 dots');
  });

  it('makes a signal op a node of its own', () => {
    expect(node(pointerGlow, 'sig:glow:weight:0')?.label).toBe('slew(riseMs 150, fallMs 900)');
    expect(edges(pointerGlow)).toContainEqual(['level:mouse', 'sig:glow:weight:0', '']);
    expect(edges(pointerGlow)).toContainEqual(['sig:glow:weight:0', 'voice:glow', 'weight']);
  });

  it('marks a level the composition lacks', () => {
    const c = comp([voice({ weight: { code: 'level("gone")' } })]);
    expect(node(c, 'level:gone')).toMatchObject({ faulted: true, detail: 'missing: reads 0' });
  });

  it('gives an expression with no signal calls a node with no inputs', () => {
    const c = comp([voice({ stagger: { code: '(s) => s.index / 10' } })]);
    expect(node(c, 'expr:v:stagger')?.label).toBe('s.index / 10');
    expect(edges(c)).toContainEqual(['expr:v:stagger', 'voice:v', 'stagger']);
    expect(edges(c).filter(([, to]) => to === 'expr:v:stagger')).toEqual([]);
  });

  it('draws a voice that writes nothing, with no channel', () => {
    const c = comp([voice({ patch: { kind: 'fn', period: 1000, writes: [], at: '() => ({})' } })]);
    expect(node(c, 'voice:v')).toBeDefined();
    expect(flowOf(c).nodes.some((n) => n.kind === 'channel')).toBe(false);
  });

  it('draws one edge for a level read twice', () => {
    const c = comp(
      [voice({ weight: { code: '(s, set) => level("a")(s, set) * level("a")(s, set)' } })],
      [{ name: 'a', value: 1, min: 0, max: 1 }],
    );
    expect(edges(c).filter(([from]) => from === 'level:a')).toHaveLength(1);
  });

  it('keeps an unparsable expression as one faulted node', () => {
    const c = comp([voice({ weight: { code: 'level("a"' } })]);
    expect(node(c, 'expr:v:weight')).toMatchObject({ kind: 'expr', faulted: true });
  });

  it('marks a voice that failed to compile', () => {
    expect(
      flowOf(crossfade, new Set(['warm'])).nodes.find((n) => n.id === 'voice:warm')?.faulted,
    ).toBe(true);
  });

  it('gives an empty composition a pose and nothing else', () => {
    expect(flowOf(comp([])).nodes.map((n) => n.id)).toEqual(['pose']);
  });
});

describe('writesOf', () => {
  it('reads keys, fn and motion patches', () => {
    expect(
      writesOf({ kind: 'keys', period: 1, stops: [{ at: 0, delta: { scale: 1, color: 0 } }] }),
    ).toEqual(['scale', 'color']);
    expect(writesOf({ kind: 'fn', period: 1, writes: ['turn'], at: '' })).toEqual(['turn']);
    expect(writesOf({ kind: 'spring', channel: 'offset', opts: {} })).toEqual(['offset']);
  });
});

describe('foldOf', () => {
  it('keeps only what reaches the channel', () => {
    const fold = foldOf(flowOf(crossfade), 'scale');
    expect(new Set(fold.nodes.map((n) => n.id))).toEqual(
      new Set([
        'ch:scale',
        'voice:warm',
        'voice:cool',
        'expr:warm:weight',
        'level:mix',
        'rest:scale',
      ]),
    );
    expect(fold.edges.some((e) => e.to === 'pose')).toBe(false);
  });

  it('adds the rest the channel folds from, when it has one', () => {
    const fold = foldOf(flowOf(crossfade), 'scale');
    expect(fold.nodes.find((n) => n.id === 'rest:scale')).toMatchObject({
      kind: 'rest',
      detail: String(KIT.scale.rest),
    });
    expect(fold.edges).toContainEqual(
      expect.objectContaining({ from: 'rest:scale', to: 'ch:scale' }),
    );
  });

  it('has no rest node for a channel without a rest', () => {
    expect(foldOf(flowOf(crossfade), 'color').nodes.some((n) => n.kind === 'rest')).toBe(false);
  });

  it('is empty when nothing writes the channel', () => {
    expect(foldOf(flowOf(crossfade), 'turn')).toEqual({ nodes: [], edges: [] });
  });

  it('formats a vector rest', () => {
    const fold = foldOf(flowOf(staggerWave), 'offset');
    expect(fold.nodes.find((n) => n.kind === 'rest')?.detail).toBe('[0, 0]');
  });
});
