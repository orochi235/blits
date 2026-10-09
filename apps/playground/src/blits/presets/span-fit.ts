import type { Composition, Voice } from '../composition';

const kid = (v: Pick<Voice, 'id' | 'hue' | 'patch'> & Partial<Voice>): Voice => ({
  name: v.id,
  start: 0,
  rate: 1,
  loop: 1,
  weight: 1,
  fade: {},
  owner: 'fit',
  ...v,
});

const swing = (period: number, delta: Record<string, number>) => {
  const rest = Object.fromEntries(Object.keys(delta).map((k) => [k, 0]));
  return {
    kind: 'keys' as const,
    period,
    stops: [
      { at: 0, delta: rest },
      { at: 0.5, delta, ease: 'ease-in-out' as const },
      { at: 1, delta: rest, ease: 'ease-in-out' as const },
    ],
  };
};

// 2.9 s of voices in a 2 s span: `spin` speeds up, `flash` runs alongside it, `tint` is shed,
// and the last 100 ms runs over, inside the 1.2 cap.
const c: Composition = {
  version: 1,
  title: 'span fit',
  stage: { kind: 'dots', cols: 8, rows: 4 },
  length: 3000,
  levels: [],
  groups: [
    {
      id: 'fit',
      name: 'fit',
      hue: 160,
      kind: 'span',
      start: 0,
      rate: 1,
      weight: 1,
      fade: {},
      span: {
        duration: 2000,
        order: 'queue',
        fit: [{ kind: 'condense' }, { kind: 'shed' }, { kind: 'overrun', cap: 1.2 }],
      },
    },
  ],
  voices: [
    kid({ id: 'grow', hue: 40, patch: swing(1500, { scale: 1.8 }) }),
    kid({ id: 'spin', hue: 280, hints: { faster: 1.5 }, patch: swing(900, { turn: 180 }) }),
    kid({ id: 'flash', hue: 200, hints: { overlap: true }, patch: swing(300, { glow: 1 }) }),
    kid({
      id: 'tint',
      hue: 330,
      hints: { ballast: true },
      patch: { kind: 'keys', period: 200, stops: [{ at: 0, delta: { color: 0xff5fa2 } }] },
    }),
  ],
};
export default c;
