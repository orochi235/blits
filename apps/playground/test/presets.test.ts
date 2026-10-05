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

it('freeze handover: rise freezes, then fades out as drop starts', () => {
  const comp = PRESETS.find((x) => x.name === 'freeze handover')?.comp;
  if (!comp) throw new Error('no freeze handover');
  const subjects = subjectsOf(comp.stage);
  const p = new Player(() => compile(comp, subjects), subjects, { levels: comp.levels });
  const state = (id: string) => p.built.handles.get(id)?.state;
  p.seek(1900);
  expect([state('rise'), state('drop')]).toEqual(['frozen', 'pending']);
  p.seek(2100);
  expect([state('rise'), state('drop')]).toEqual(['fading', 'live']);
  p.seek(2600);
  expect([state('rise'), state('drop')]).toEqual(['done', 'live']);
});

it('has the six presets the spec lists, the first the default', () => {
  expect(PRESETS.map((x) => x.name)).toEqual([
    'stagger wave',
    'crossfade',
    'spring retarget',
    'freeze handover',
    'pointer glow',
    'fold rules',
  ]);
  expect(DEFAULT).toBe(PRESETS[0]?.comp);
});
