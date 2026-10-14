import type { Composition, Voice } from '../composition';

const pulse = (period: number, delta: Record<string, number>, rest = 0) => ({
  kind: 'keys' as const,
  period,
  stops: [
    { at: 0, delta: Object.fromEntries(Object.keys(delta).map((k) => [k, rest])) },
    { at: 0.5, delta, ease: 'ease-in-out' as const },
    { at: 1, delta: Object.fromEntries(Object.keys(delta).map((k) => [k, rest])) },
  ],
});

const voice = (v: Pick<Voice, 'id' | 'hue' | 'patch'> & Partial<Voice>): Voice => ({
  name: v.id,
  start: 0,
  rate: 1,
  loop: 1,
  weight: 1,
  fade: {},
  ...v,
});

// `both` waits for `intro` and the mark; `either` for whichever of `intro` and `glint` ends first;
// `outro` for the span, whose two voices play in turn.
const c: Composition = {
  version: 1,
  title: 'anchors',
  stage: { kind: 'dots', cols: 8, rows: 3 },
  length: 6000,
  levels: [],
  announced: [{ name: 'beat', at: 2000 }],
  groups: [
    {
      id: 'pair',
      name: 'pair',
      hue: 160,
      kind: 'span',
      start: 0,
      rate: 1,
      weight: 1,
      fade: {},
      anchor: { start: { after: 'both' } },
      span: { order: 'queue' },
    },
  ],
  voices: [
    voice({ id: 'intro', hue: 40, start: 200, patch: pulse(1000, { glow: 1 }) }),
    voice({
      id: 'glint',
      hue: 90,
      start: 300,
      tags: ['spark'],
      patch: pulse(400, { scale: 1.5 }, 1),
    }),
    voice({
      id: 'both',
      hue: 200,
      anchor: { start: { all: [{ after: 'intro' }, { with: 'beat' }] } },
      patch: pulse(800, { turn: 90 }),
    }),
    voice({
      id: 'either',
      hue: 280,
      anchor: { start: { any: [{ after: 'intro' }, { after: { tag: 'spark' }, by: 100 }] } },
      patch: pulse(600, { opacity: 0.3 }, 1),
    }),
    voice({ id: 'one', hue: 130, owner: 'pair', patch: pulse(500, { glow: 1 }) }),
    voice({ id: 'two', hue: 170, owner: 'pair', patch: pulse(500, { scale: 1.4 }, 1) }),
    voice({
      id: 'outro',
      hue: 330,
      anchor: { start: { of: 'pair', mark: 'end', by: 200 } },
      patch: pulse(900, { turn: -90 }),
    }),
  ],
};
export default c;
