import { edgesOf } from '@pg/widgets/FlowDiagram/edges';
import { edgeStyleOf } from '@pg/widgets/FlowDiagram/style';
import { describe, expect, it } from 'vitest';

describe('FlowDiagram edges', () => {
  it('styles two edges between the same nodes each by its own', () => {
    const { specs, styleOf } = edgesOf(
      [
        { id: 'a->b', from: 'a', to: 'b' },
        { id: 't:a->b', from: 'a', to: 'b', timing: true },
      ],
      'down',
    );
    expect(specs.map(styleOf)).toEqual([edgeStyleOf({}), edgeStyleOf({ timing: true })]);
  });
  it('gives each edge an id no picker reads as a node', () => {
    const { specs } = edgesOf([{ id: 'voice:a->b', from: 'voice:a', to: 'b' }], 'down');
    expect(specs[0]?.id?.startsWith('voice:')).toBe(false);
  });
});
