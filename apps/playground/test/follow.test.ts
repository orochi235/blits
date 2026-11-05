import { watched } from '@msb235/blits';
import { compile } from '@pg/blits/compile';
import { FRAME } from '@pg/blits/frame';
import { Player } from '@pg/blits/player';
import { describe, expect, it } from 'vitest';
import { comp, subjects, voice } from './helpers';

const c = comp([
  voice({
    id: 'a',
    patch: {
      kind: 'keys',
      period: 1000,
      stops: [
        { at: 0, delta: { turn: 0 } },
        { at: 1, delta: { turn: 90 } },
      ],
      ease: 'linear',
    },
  }),
]);
const player = () => new Player(() => compile(c, subjects, { solos: true }), subjects);
const holdOf = (p: Player) => {
  const entry = watched()
    .entries()
    .find((e) => e.mix === p.built.mix);
  if (!entry) throw new Error('the full mix is not listed');
  return entry.hold();
};

describe('a clock held elsewhere', () => {
  it('is never taken for one, playing alone', () => {
    const p = player();
    for (let f = 1; f <= 120; f++) {
      p.seek(f * FRAME);
      expect(p.following).toBe(false);
    }
    expect(p.t).toBe(120 * FRAME);
  });

  it('holds the score, the stage and the solos where the hold stops the mix', () => {
    const p = player();
    p.seek(30 * FRAME);
    const hold = holdOf(p);
    p.seek(p.t + FRAME);
    const t = p.t;
    const turn = p.columns.turn[0];
    for (let k = 0; k < 20; k++) p.seek(p.t + FRAME);
    expect(p.following).toBe(true);
    expect(p.t).toBe(t);
    expect(p.columns.turn[0]).toBe(turn);
    const solo = p.built.solos.get('a');
    expect(solo?.now).toBeCloseTo(p.built.mix.now, 6);
    hold.free();
  });

  it('moves the score where the hold seeks, and plays on from there once freed', () => {
    const p = player();
    p.seek(60 * FRAME);
    const hold = holdOf(p);
    hold.seek(200);
    p.seek(p.t + FRAME);
    expect(p.t).toBeCloseTo(200, 6);
    expect(p.columns.turn[0]).toBeCloseTo(18, 3);
    expect(p.built.solos.get('a')?.now).toBeCloseTo(200, 6);
    hold.free();
    p.seek(p.t + FRAME);
    p.seek(p.t + FRAME);
    expect(p.following).toBe(false);
    expect(p.t).toBeGreaterThan(200);
    expect(p.t).toBeLessThan(260);
  });
});
