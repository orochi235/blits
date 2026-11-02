import { affine, color, kit, matrix, mix, overlay, patch, sum, watched } from '@msb235/blits';
import { expect, it } from 'vitest';
import { readPose } from '../src/pose.js';

interface Pose {
  x: number;
  tint: number[];
  stack: number[];
  at: number[];
}
const K = kit<Pose>({ x: sum(), tint: color(), stack: color(overlay()), at: affine() });

function setup() {
  const m = mix<string, Pose>(K, { name: 'pose-read' });
  const e = watched()
    .entries()
    .find((w) => w.mix === (m as unknown));
  if (e === undefined) throw new Error('not watched');
  const lay = (L: number, cov: number) =>
    patch<string, Pose>(
      0,
      () => ({
        x: 2,
        tint: [L * cov, 0, 0, cov],
        stack: [L, 0, 0, 1],
        at: matrix({ x: 5, rotate: 0.5 }),
      }),
      { writes: ['x', 'tint', 'stack', 'at'] },
    );
  m.cue({ patch: lay(0.4, 1), subjects: ['s'] });
  m.cue({ patch: lay(0.8, 1), subjects: ['s'], weight: 0.5 });
  m.sync(0);
  return { pose: m.probe('s'), e, close: () => m.close() };
}

it('reads a color channel as the CSS colors it shows, an ordered mode with its layers', () => {
  const { pose, e, close } = setup();
  const { colors, values } = readPose(pose, e);
  expect(colors.tint).toHaveLength(1);
  expect(colors.tint?.[0]).toMatch(/^oklab\(/);
  expect(colors.stack).toHaveLength(3);
  expect(colors.stack?.[1]).toMatch(/^color\(srgb-linear .* \/ 1\)$/);
  expect(colors.stack?.[2]).toMatch(/\/ 0\.5\)$/);
  expect(Object.keys(values).some((k) => k.startsWith('tint') || k.startsWith('stack'))).toBe(
    false,
  );
  close();
});

it('reads an affine channel as its parts, and any other channel as its numbers', () => {
  const { pose, e, close } = setup();
  const { values } = readPose(pose, e);
  expect(values.x).toBe(3);
  const back = matrix({
    x: values['at.x'],
    y: values['at.y'],
    rotate: values['at.rotate'],
    skew: values['at.skew'],
    scaleX: values['at.scaleX'],
    scaleY: values['at.scaleY'],
  });
  back.forEach((n, i) => {
    expect(n).toBeCloseTo(pose.at[i] as number, 9);
  });
  expect(values['at.rotate']).toBeGreaterThan(0.5);
  expect(Object.keys(values).filter((k) => k.startsWith('at'))).toEqual([
    'at.x',
    'at.y',
    'at.rotate',
    'at.skew',
    'at.scaleX',
    'at.scaleY',
  ]);
  close();
});
