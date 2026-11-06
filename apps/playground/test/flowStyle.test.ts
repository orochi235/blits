import { hueColor } from '@msb235/blits-panel';
import { edgeStyleOf, FAULT, rowsOf, styleOf } from '@pg/widgets/FlowDiagram/style';
import { describe, expect, it } from 'vitest';

describe('FlowDiagram styling', () => {
  it('puts the label, then each line of the detail, on rows', () => {
    expect(rowsOf({ id: 'sig', kind: 'signal', label: 'sig', detail: 'x\ny' })).toEqual([
      { kind: 'label', text: 'sig' },
      { kind: 'label', text: 'x' },
      { kind: 'label', text: 'y' },
    ]);
  });

  it('heads a named node with its label, uppercased, and the aside beside it', () => {
    const [head] = rowsOf({ id: 'voice:a', kind: 'voice', label: 'a', aside: 'keys' });
    expect(head).toMatchObject({ kind: 'header', text: 'A', aside: 'KEYS' });
  });

  it('draws a timing edge in a color of its own, met or not', () => {
    const flow = edgeStyleOf({}).stroke;
    const timing = edgeStyleOf({ timing: true }).stroke;
    expect(timing).not.toBe(flow);
    expect(edgeStyleOf({ timing: true, met: false }).stroke).not.toBe(timing);
  });

  it('strokes a voice in its hue', () => {
    expect(styleOf({ id: 'voice:a', kind: 'voice', label: 'a', hue: 200 }).stroke).toBe(
      hueColor(200),
    );
  });

  it('strokes a faulted node in the fault color, heavier', () => {
    const s = styleOf({ id: 'level:x', kind: 'level', label: 'x', faulted: true });
    expect(s.stroke).toBe(FAULT);
    expect(s.strokeWidth).toBe(3);
  });
});
