import { flowOf } from '@pg/blits/flow';
import staggerWave from '@pg/blits/presets/stagger-wave';
import { delaysOf, stampDelays } from '@pg/blits/stamps';
import { describe, expect, it } from 'vitest';

describe('delaysOf', () => {
  it("gives each subject its stagger, in the stage's order and shape", () => {
    const c = { ...staggerWave, stage: { kind: 'dots' as const, cols: 3, rows: 2 } };
    expect(delaysOf(c, '(s) => s.col * 90 + s.row * 30')).toEqual({
      cols: 3,
      rows: 2,
      values: [0, 90, 180, 30, 120, 210],
    });
  });

  it('gives a subject the expression throws on what the mix does, and gives up on one that does not compile', () => {
    const c = { ...staggerWave, stage: { kind: 'letters' as const, text: 'ab' } };
    expect(delaysOf(c, '(s) => { if (s.index) throw 1; return 5; }')?.values).toEqual([5, 0]);
    expect(delaysOf(c, '(s) => s.col *')).toBeNull();
  });
});

describe('stampDelays', () => {
  it("draws a stagger step as its stage, with the delays' spread beside it", () => {
    const flow = stampDelays(flowOf(staggerWave), staggerWave);
    const step = flow.nodes.find((n) => n.kind === 'step' && n.label === 'stagger');
    const { cols, rows } = staggerWave.stage as { cols: number; rows: number };
    expect(step?.grid?.values).toHaveLength(cols * rows);
    expect(step?.params).toContainEqual(['spread', expect.stringMatching(/^0 ms–\d+ ms$/)]);
  });
});
