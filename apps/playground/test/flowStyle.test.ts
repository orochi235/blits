import { edgeStyleOf, FAULT, linesOf, styleOf } from '@pg/widgets/FlowDiagram/style';
import { hueColor } from '@pg/widgets/hue';
import { describe, expect, it } from 'vitest';

describe('FlowDiagram styling', () => {
  it('puts the label, then the detail, on lines', () => {
    expect(linesOf({ id: 'ch:color', kind: 'channel', label: 'color', detail: 'hex' })).toEqual([
      'color',
      'hex',
    ]);
    expect(linesOf({ id: 'pose', kind: 'pose', label: 'pose' })).toEqual(['pose']);
  });

  it('puts each line of a detail on its own line', () => {
    expect(linesOf({ id: 'voice:a', kind: 'voice', label: 'a', detail: 'keys\nat 0 ms' })).toEqual([
      'a',
      'keys',
      'at 0 ms',
    ]);
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
