import { flowKey } from '@pg/app/flowKey';
import { flowOf } from '@pg/blits/flow';
import { PRESETS } from '@pg/blits/presets';
import { describe, expect, it } from 'vitest';

describe('flowKey', () => {
  const first = PRESETS[0];
  if (!first) throw new Error('no presets');
  const comp = first.comp;
  it('is the same for an edit that leaves the graph alone', () => {
    const moved = { ...comp, voices: comp.voices.map((v) => ({ ...v, start: v.start + 100 })) };
    expect(flowKey(flowOf(moved, new Set()))).toBe(flowKey(flowOf(comp, new Set())));
  });
  it('changes when a node is faulted', () => {
    const id = comp.voices.map((v) => v.id);
    expect(flowKey(flowOf(comp, new Set(id)))).not.toBe(flowKey(flowOf(comp, new Set())));
  });
});
