import { FAULT, linesOf, styleOf } from '@pg/widgets/FlowDiagram/style';
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
