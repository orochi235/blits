import { compose } from '@brand/glyphs.js';
import { logoHues } from '@brand/hues.js';
import { input, type SpanHandle } from '@msb235/blits';
import { compile } from '@pg/blits/compile';
import type { Expr } from '@pg/blits/composition';
import { compileExpr, scopeOf } from '@pg/blits/expr';
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
    'blend',
    'spring retarget',
    'freeze handover',
    'pointer glow',
    'bounded glow',
    'fold rules',
    'owner fade',
    'span fit',
    'marks and hits',
    'anchors',
    'backward',
    'logo',
  ]);
  expect(DEFAULT).toBe(PRESETS[0]?.comp);
});

it('bounded glow: the glow follows the pointer, and a replay starts it where the pointer was', () => {
  const comp = PRESETS.find((x) => x.name === 'bounded glow')?.comp;
  if (!comp) throw new Error('no bounded glow');
  const subjects = subjectsOf(comp.stage);
  const p = new Player(() => compile(comp, subjects, { solos: true }), subjects, {
    levels: comp.levels,
  });
  const glow = p.built.handles.get('glow');
  const at = (col: number, row: number) =>
    subjects.findIndex((s) => s.col === col && s.row === row);
  const corner = at(0, 0);
  p.seek(100);
  expect(glow?.weightOf(subjects[corner] as Subject)).toBe(0);
  p.point(0, 0);
  expect(p.built.handles.get('glow')?.weightOf(subjects[corner] as Subject)).toBe(1);
  expect(p.columns.glow[corner]).toBe(2);
  expect(p.columns.glow[at(10, 10)]).toBe(0);
  p.seek(0);
  expect(p.built.handles.get('glow')?.weightOf(subjects[corner] as Subject)).toBe(1);
  expect(p.columns.glow[at(1, 0)]).toBeGreaterThan(0);
});

it('every weight and blend built on a level stays an input, so a history records it', () => {
  for (const { name, comp } of PRESETS) {
    const scope = { ...scopeOf(comp.levels), around: () => input<Subject>(() => 1) };
    const exprs = [
      ...comp.voices.map((v) => v.weight),
      ...(comp.groups ?? []).map((g) => g.weight),
      ...Object.values(comp.blends ?? {}),
    ].filter((w): w is Expr => typeof w === 'object' && w.code.includes('level('));
    for (const expr of exprs) {
      const r = compileExpr(expr, scope, 0);
      if ('error' in r) throw new Error(`${name}: ${r.error}`);
      expect([name, (r.fn as { input?: boolean }).input]).toEqual([name, true]);
    }
  }
});

describe('logo', () => {
  const comp = PRESETS.find((x) => x.name === 'logo')?.comp;
  if (!comp) throw new Error('no logo');
  const play = (hover: number) => {
    const subjects = subjectsOf(comp.stage);
    const p = new Player(() => compile(comp, subjects), subjects, { levels: comp.levels });
    p.setLevel('hover', hover);
    p.seek(1000);
    p.point(10, 5);
    return { p, subjects };
  };

  it("turns its hues on the rail sign's whole board, the rows below the word included", () => {
    const voice = comp.voices.find((v) => v.id === 'hues');
    if (voice?.patch.kind !== 'fn') throw new Error('no hues');
    const at = new Function(`return ${voice.patch.at}`)() as (
      phase: number,
      s: { col: number; row: number },
    ) => { color: number };
    const { CYCLE, hueAt, turnedHex } = logoHues();
    const word = compose('blits');
    // The rail's sign: a dot of padding, the word a column in, 3 rows above it and 13 below.
    const cols = word.cols + 4;
    const rows = 1 + 3 + word.rows + 13 + 1;
    for (let phase = 0; phase < 1; phase += 0.01)
      for (const s of [
        { col: 3, row: 4 },
        { col: 10, row: 9 },
      ])
        expect(at(phase, s).color).toBe(turnedHex(hueAt(phase * CYCLE, s.col, s.row, cols, rows)));
  });

  it('lights its halo only while hovered, as the rail does', () => {
    const at = (p: Player, subjects: readonly Subject[]) =>
      p.columns.glow[subjects.findIndex((s) => s.col === 10 && s.row === 5)];
    const off = play(0);
    expect(at(off.p, off.subjects)).toBe(0);
    const on = play(1);
    expect(at(on.p, on.subjects)).toBeGreaterThan(0);
  });
});
