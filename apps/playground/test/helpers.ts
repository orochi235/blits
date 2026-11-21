import type { Mix, Transport } from '@msb235/blits';
import type { Composition, Group, Voice } from '@pg/blits/composition';
import { FRAME } from '@pg/blits/frame';
import type { Mixed } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
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

/** Plays `p` `n` frames, syncing its transport a frame's time apart, as the animation frame does. */
export function step(p: Player, n = 1) {
  for (let k = 0; k < n; k++) p.sync(p.host + FRAME);
}

/** Plays `p` frame by frame until its score reaches mix time `t`. */
export function play(p: Player, t: number) {
  while (p.t < t - 1e-9) step(p);
}

/** A mix of its own, or one on a transport with the transport that moves it, such as a compile. */
export type Played = Mix<Subject, Mixed> | { mix: Mix<Subject, Mixed>; transport: Transport };

export const partsOf = (p: Played) =>
  'transport' in p && 'mix' in p ? p : { mix: p, transport: p as { sync(t: number): void } };

/** Plays both mixes frame by frame and compares every subject's pose, to the bit. */
export function same(a: Played, b: Played, ms = 1500) {
  const x = partsOf(a);
  const y = partsOf(b);
  for (let t = 0; t <= ms; t += FRAME) {
    x.transport.sync(t);
    y.transport.sync(t);
    for (const s of subjects) expect(x.mix.probe(s)).toStrictEqual(y.mix.probe(s));
  }
}
