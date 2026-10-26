import { flowOf } from '@pg/blits/flow';
import blend from '@pg/blits/presets/blend';
import { jobOf, wired } from '@pg/blits/wire';
import { describe, expect, it } from 'vitest';
import { comp, group, voice } from './helpers';

const keys = { kind: 'keys' as const, period: 500, stops: [{ at: 0, delta: { glow: 1 } }] };
const base = {
  ...comp(
    [
      voice({ id: 'a', patch: keys }),
      voice({ id: 'b', patch: keys, weight: { code: "slew(level('x'), { riseMs: 100 })" } }),
      voice({ id: 'k', patch: keys, owner: 's' }),
    ],
    [group({ id: 'g' }), group({ id: 's', kind: 'span', span: {} })],
  ),
  levels: [{ name: 'x', value: 0, min: 0, max: 1 }],
};
const code = flowOf(base).code;
const end = (node: string, port: string) => ({ node, port });
const sig = [...code.keys()].find((k) => k.startsWith('sig:')) as string;

describe('jobOf', () => {
  it('reads a voice or group by its top, start and end, and a signal or mark by its bottom', () => {
    expect(['n', 'w', 'e', 's'].map((p) => jobOf(code, 'voice:a', p))).toEqual([
      'weight',
      'start',
      'end',
      null,
    ]);
    expect(jobOf(code, 'group:g', 'e')).toBe('end');
    expect(jobOf(code, 'level:x', 's')).toBe('signal');
    expect(jobOf(code, sig, 's')).toBe('signal');
    expect(jobOf(code, 'level:x', 'n')).toBe(null);
    expect(jobOf(code, 'mark:beat', 's')).toBe('mark');
    expect(jobOf(code, 'ch:glow', 's')).toBe(null);
  });
});

describe('wired', () => {
  it('makes a level dropped on a voice its weight, read either way round', () => {
    const want = { code: 'level("x")' };
    expect(wired(base, code, end('level:x', 's'), end('voice:a', 'n'))?.voices[0]?.weight).toEqual(
      want,
    );
    expect(wired(base, code, end('voice:a', 'n'), end('level:x', 's'))?.voices[0]?.weight).toEqual(
      want,
    );
  });

  it('takes a signal call by its source, and weights a group too', () => {
    const next = wired(base, code, end(sig, 's'), end('group:g', 'n'));
    expect(next?.groups?.[0]?.weight).toEqual({ code: "slew(level('x'), { riseMs: 100 })" });
  });

  it('refuses a weight it already has, and a signal on a start', () => {
    const again = wired(base, code, end(sig, 's'), end('voice:b', 'n'));
    expect(again).toBe(null);
    expect(wired(base, code, end('level:x', 's'), end('voice:a', 'w'))).toBe(null);
  });

  it('sets a blend’s signal for a voice in one', () => {
    const c = flowOf(blend).code;
    const v = blend.voices[0];
    const level = [...c.keys()].find((k) => k.startsWith('level:')) as string;
    const next = wired(blend, c, end(level, 's'), end(`voice:${v?.id}`, 'n'));
    const role = v?.role as string;
    expect(next?.blends?.[role]).toEqual({ code: c.get(level) });
  });

  it('anchors by start and end: with a start, after an end, dropping the paired slot', () => {
    const c = {
      ...base,
      voices: base.voices.map((v) => (v.id === 'b' ? { ...v, anchor: { in: 5 } } : v)),
    };
    expect(wired(c, code, end('voice:a', 'e'), end('voice:b', 'w'))?.voices[1]?.anchor).toEqual({
      start: { after: 'a' },
    });
    expect(wired(c, code, end('voice:a', 'w'), end('voice:b', 'e'))?.voices[1]?.anchor).toEqual({
      in: 5,
      end: { with: 'a' },
    });
  });

  it('anchors a group, and to a mark either way round', () => {
    expect(
      wired(base, code, end('voice:a', 'e'), end('group:g', 'w'))?.groups?.[0]?.anchor,
    ).toEqual({ start: { after: 'a' } });
    const want = { start: { with: 'beat' } };
    expect(
      wired(base, code, end('mark:beat', 's'), end('voice:a', 'w'))?.voices[0]?.anchor,
    ).toEqual(want);
    expect(
      wired(base, code, end('voice:a', 'w'), end('mark:beat', 's'))?.voices[0]?.anchor,
    ).toEqual(want);
  });

  it('refuses a start under a span, a node to itself, and a top to a start', () => {
    expect(wired(base, code, end('voice:a', 'e'), end('voice:k', 'w'))).toBe(null);
    expect(wired(base, code, end('voice:a', 'e'), end('voice:k', 'e'))).not.toBe(null);
    expect(wired(base, code, end('voice:a', 'e'), end('voice:a', 'w'))).toBe(null);
    expect(wired(base, code, end('voice:a', 'n'), end('voice:b', 'w'))).toBe(null);
  });
});
