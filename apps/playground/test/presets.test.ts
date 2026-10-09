import type { SpanHandle } from '@msb235/blits';
import { compile } from '@pg/blits/compile';
import { FRAME } from '@pg/blits/frame';
import { load } from '@pg/blits/load';
import { Player } from '@pg/blits/player';
import { DEFAULT, PRESETS } from '@pg/blits/presets';
import { type Subject, subjectsOf } from '@pg/blits/stage';
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

it('owner fade: the owner fades its voices in and out as one', () => {
  const comp = PRESETS.find((x) => x.name === 'owner fade')?.comp;
  if (!comp) throw new Error('no owner fade');
  const subjects = subjectsOf(comp.stage);
  const p = new Player(() => compile(comp, subjects), subjects, { levels: comp.levels });
  const ws = () =>
    new Set(comp.voices.map((v) => p.built.handles.get(v.id)?.weightOf(subjects[0] as Subject)));
  p.seek(500);
  expect(ws().size).toBe(1);
  expect([...ws()][0]).toBeCloseTo(0.5, 9);
  p.seek(1000);
  expect(ws()).toEqual(new Set([1]));
  p.seek(2800);
  expect(comp.voices.map((v) => p.built.handles.get(v.id)?.state)).toEqual([
    'done',
    'done',
    'done',
  ]);
});

it('span fit: speeds one up, overlaps one, sheds the ballast, and runs over inside the cap', () => {
  const comp = PRESETS.find((x) => x.name === 'span fit')?.comp;
  if (!comp) throw new Error('no span fit');
  const subjects = subjectsOf(comp.stage);
  const p = new Player(() => compile(comp, subjects), subjects, { levels: comp.levels });
  const fit = { budget: 2000, length: 2100, over: 100, skipped: 1, fell: false };
  const result = () => (p.built.groupHandles.get('fit') as SpanHandle).result;
  expect(result()).toEqual(fit);
  expect(p.built.handles.get('spin')?.rate).toBe(1.5);
  p.seek(1700);
  expect(p.built.handles.get('flash')?.state).toBe('live');
  for (let t = 1700; t <= 2200; t += 100) {
    p.seek(t);
    expect(Number.isNaN(p.columns.color[0])).toBe(true);
  }
  expect(result()).toEqual(fit);
});

it('has the presets the spec lists, the first the default', () => {
  expect(PRESETS.map((x) => x.name)).toEqual([
    'stagger wave',
    'crossfade',
    'spring retarget',
    'freeze handover',
    'pointer glow',
    'fold rules',
    'owner fade',
    'span fit',
  ]);
  expect(DEFAULT).toBe(PRESETS[0]?.comp);
});
