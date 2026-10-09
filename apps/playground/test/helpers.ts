import type { Mix } from '@msb235/blits';
import type { Composition, Group, Voice } from '@pg/blits/composition';
import { FRAME } from '@pg/blits/frame';
import type { Mixed } from '@pg/blits/kit';
import { type Subject, subjectsOf } from '@pg/blits/stage';
import { expect } from 'vitest';

export const voice = (v: Partial<Voice> & Pick<Voice, 'id' | 'patch'>): Voice => ({
  name: v.id,
  hue: 0,
  start: 0,
  rate: 1,
  loop: true,
  weight: 1,
  fade: {},
  ...v,
});

export const group = (g: Partial<Group> & Pick<Group, 'id'>): Group => ({
  name: g.id,
  hue: 0,
  kind: 'owner',
  start: 0,
  rate: 1,
  weight: 1,
  fade: {},
  ...g,
});

export const comp = (voices: Voice[], groups?: Group[]): Composition => ({
  version: 1,
  title: 't',
  stage: { kind: 'dots', cols: 3, rows: 2 },
  length: 2000,
  levels: [],
  voices,
  ...(groups ? { groups } : {}),
});

export const subjects = subjectsOf({ kind: 'dots', cols: 3, rows: 2 });

/** Plays both mixes frame by frame and compares every subject's pose, to the bit. */
export function same(a: Mix<Subject, Mixed>, b: Mix<Subject, Mixed>, ms = 1500) {
  for (let t = 0; t <= ms; t += FRAME) {
    a.sync(t);
    b.sync(t);
    for (const s of subjects) expect(a.probe(s)).toStrictEqual(b.probe(s));
  }
}
