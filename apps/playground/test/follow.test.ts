import { watched } from '@msb235/blits';
import { compile } from '@pg/blits/compile';
import { FRAME } from '@pg/blits/frame';
import { Player } from '@pg/blits/player';
import { describe, expect, it } from 'vitest';
import { comp, play, step, subjects, voice } from './helpers';

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
      play(p, f * FRAME);
      expect(p.following).toBe(false);
    }
    expect(p.t).toBeCloseTo(120 * FRAME, 9);
  });

  it('holds the score, the stage and the solos where the hold stops the mix', () => {
    const p = player();
    play(p, 30 * FRAME);
    const hold = holdOf(p);
    step(p);
    const t = p.t;
    const turn = p.columns.turn[0];
    step(p, 20);
    expect(p.following).toBe(true);
    expect(p.t).toBe(t);
    expect(p.columns.turn[0]).toBe(turn);
    const solo = p.built.solos.get('a');
    expect(solo?.now).toBeCloseTo(p.built.mix.now, 6);
    hold.free();
  });

  it('moves the score where the hold seeks, and plays on from there once freed', () => {
    const p = player();
    play(p, 60 * FRAME);
    const hold = holdOf(p);
    hold.seek(200);
    step(p);
    expect(p.t).toBeCloseTo(200, 6);
    expect(p.columns.turn[0]).toBeCloseTo(18, 3);
    expect(p.built.solos.get('a')?.now).toBeCloseTo(200, 6);
    hold.free();
    step(p);
    step(p);
    expect(p.following).toBe(false);
    expect(p.t).toBeGreaterThan(200);
    expect(p.t).toBeLessThan(260);
  });
});

describe('a replay after a hold', () => {
  /** A player held at half rate, stepped, sought back if `back`, stopped and freed; each frame. */
  const heldRun = (back: boolean) => {
    const p = player();
    p.seekBy = 'replay';
    play(p, 30 * FRAME);
    const hold = holdOf(p);
    const shown: { t: number; turn: number }[] = [];
    const frame = (n: number) => {
      for (let k = 0; k < n; k++) {
        step(p);
        shown.push({ t: p.t, turn: p.columns.turn[0] as number });
      }
    };
    hold.rate = 0.5;
    frame(10);
    hold.step(100);
    frame(5);
    const ahead = shown.length;
    if (back) hold.seek(150);
    frame(5);
    hold.rate = 0;
    frame(5);
    hold.free();
    frame(10);
    return { p, shown, ahead };
  };

  it('rebuilds where playback stood, and plays on from there', () => {
    for (const back of [false, true]) {
      const { p, shown } = heldRun(back);
      const last = shown.at(-1) as { t: number; turn: number };
      p.rebuild();
      expect(p.t).toBe(last.t);
      expect(p.columns.turn[0]).toBe(last.turn);
      step(p);
      expect(p.following).toBe(false);
      expect(p.t).toBeCloseTo(last.t + FRAME, 6);
    }
  });

  it('scrubs back to each held frame as it showed', () => {
    const { p, shown, ahead } = heldRun(true);
    for (const s of shown.slice(0, ahead).reverse()) {
      p.seek(s.t);
      expect(p.t).toBe(s.t);
      expect(p.columns.turn[0]).toBeCloseTo(s.turn, 9);
    }
  });
});
