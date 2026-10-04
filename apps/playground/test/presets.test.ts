import { compile, FRAME } from '@pg/blits/compile';
import { load } from '@pg/blits/load';
import { Player } from '@pg/blits/player';
import { DEFAULT, PRESETS } from '@pg/blits/presets';
import { subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

describe.each(PRESETS)('preset $name', ({ comp }) => {
  it('compiles with no errors and plays a second with no faults', () => {
    const subjects = subjectsOf(comp.stage);
    const p = new Player(() => compile(comp, subjects, { solos: true }), subjects, {
      levels: comp.levels,
    });
    expect(p.built.errors).toEqual([]);
    expect(p.built.handles.size).toBe(comp.voices.length);
    p.seek(1000);
    for (const f of p.built.faults.values()) expect(f.count).toBe(0);
    expect(p.t).toBeCloseTo(60 * FRAME, 9);
  });

  it('loads as a shared link would', () => {
    expect(load(JSON.parse(JSON.stringify(comp)))).toEqual(comp);
  });
});

it('has the six presets the spec lists, the first the default', () => {
  expect(PRESETS.map((x) => x.name)).toEqual([
    'stagger wave',
    'crossfade',
    'spring retarget',
    'hold handover',
    'pointer glow',
    'fold rules',
  ]);
  expect(DEFAULT).toBe(PRESETS[0]?.comp);
});
