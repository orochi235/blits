import type { PatchSource } from '@pg/blits/composition';
import { deskOf, litDesk, readoutOf } from '@pg/blits/desk';
import { flowOf, writesOf } from '@pg/blits/flow';
import type { Mixed } from '@pg/blits/kit';
import { PRESETS } from '@pg/blits/presets';
import crossfade from '@pg/blits/presets/crossfade';
import ownerFade from '@pg/blits/presets/owner-fade';
import { layoutOf, MIN_PITCH } from '@pg/widgets/MixerDesk/layout';
import { describe, expect, it } from 'vitest';
import { comp, group, voice } from './helpers';

const deskFor = (c: Parameters<typeof flowOf>[0], faulted?: Set<string>) =>
  deskOf(c, flowOf(c, faulted));
const glow: PatchSource = { kind: 'keys', period: 1000, stops: [{ at: 0, delta: { glow: 1 } }] };

describe('deskOf', () => {
  it('draws the crossfade preset', () => {
    expect(deskFor(crossfade)).toEqual({
      buses: [
        { id: 'scale', label: 'scale', rule: expect.any(String) },
        { id: 'color', label: 'color', rule: expect.any(String) },
      ],
      strips: [
        expect.objectContaining({ id: 'warm', taps: ['scale', 'color'] }),
        expect.objectContaining({ id: 'cool', taps: ['scale', 'color'] }),
      ],
    });
  });

  it('taps what each voice writes, in every preset', () => {
    for (const { comp: c } of PRESETS) {
      const desk = deskFor(c);
      for (const v of c.voices)
        expect(desk.strips.find((s) => s.id === v.id)?.taps).toEqual(writesOf(v.patch));
    }
  });

  it('brackets an owner over the voices it holds', () => {
    expect(deskFor(ownerFade).groups).toEqual([
      expect.objectContaining({ id: 'band', first: 'bob', last: 'swell', depth: 0 }),
    ]);
  });

  it('keeps a group together and nests brackets, leaving out a group that holds nothing', () => {
    const c = comp(
      [
        voice({ id: 'a', patch: glow, owner: 'inner' }),
        voice({ id: 'loose', patch: glow }),
        voice({ id: 'b', patch: glow, owner: 'outer' }),
        voice({ id: 'c', patch: glow, owner: 'inner' }),
      ],
      [group({ id: 'outer' }), group({ id: 'inner', owner: 'outer' }), group({ id: 'empty' })],
    );
    const desk = deskFor(c);
    expect(desk.strips.map((s) => s.id)).toEqual(['a', 'c', 'b', 'loose']);
    expect(desk.groups?.map((g) => [g.id, g.first, g.last, g.depth])).toEqual([
      ['outer', 'a', 'b', 0],
      ['inner', 'a', 'c', 1],
    ]);
  });

  it('marks a faulted voice', () => {
    const c = comp([voice({ id: 'a', patch: glow })]);
    expect(deskFor(c, new Set(['a'])).strips[0]?.faulted).toBe(true);
  });
});

const pose: Mixed = {
  offset: [12, -3.25],
  turn: 0.5,
  scale: 1.2,
  color: [0, 0, 0, 0],
  opacity: 1,
  glow: 0,
};

describe('litDesk', () => {
  it('lights strips and groups by weight, 0 for one the mix lacks', () => {
    const lit = litDesk(deskFor(ownerFade), {
      full: pose,
      weights: new Map([
        ['bob', 0.5],
        ['band', 0.25],
      ]),
    });
    expect(lit.strips.map((s) => s.level)).toEqual([0.5, 0, 0]);
    expect(lit.groups?.[0]?.level).toBe(0.25);
  });

  it('leaves the desk unlit with no sample', () => {
    const desk = deskFor(crossfade);
    expect(litDesk(desk, undefined)).toBe(desk);
  });

  it('prints each channel with fixed places, and a color with its swatch', () => {
    expect(readoutOf('offset', pose)).toEqual({ value: '12.0, -3.3' });
    expect(readoutOf('scale', pose)).toEqual({ value: '1.20' });
    expect(readoutOf('color', pose)).toEqual({ value: 'none' });
    const red = readoutOf('color', { ...pose, color: [0.627955, 0.224863, 0.125846, 1] });
    expect(red.value).toMatch(/^#f[ef]0000$/);
    expect(red.swatch).toBe(red.value);
  });
});

describe('layoutOf', () => {
  it('fits every preset in the right column, less a scrollbar', () => {
    for (const { comp: c } of PRESETS) expect(layoutOf(deskFor(c), 340).width).toBe(340);
  });

  it('grows a crowded desk wider rather than squeezing its strips', () => {
    const voices = Array.from({ length: 20 }, (_, i) => voice({ id: `v${i}`, patch: glow }));
    const at = layoutOf(deskFor(comp(voices)), 360);
    expect(at.pitch).toBe(MIN_PITCH);
    expect(at.width).toBeGreaterThan(360);
  });
});
