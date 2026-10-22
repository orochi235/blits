import { mix } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import {
  board,
  CHASE_MS,
  chase,
  HOLD_MS,
  hold,
  KIT,
  type Led,
  type Pose,
  SIZE,
  STEP_MS,
  type Subject,
  scroll,
} from '../src/board';
import { rasterize } from '../src/font';
import { length, play } from '../src/show';

const b = board(SIZE.cols, SIZE.rows);
const COLS = b.cols;
const dot = (x: number, y: number) => b.dots[y * COLS + x] as Led;
const setting = {} as never;

describe('rasterize', () => {
  it('lays glyphs out five dots wide with a blank column after each', () => {
    const text = rasterize('ii');
    expect(text.cols).toBe(12);
    expect(text.lit(2, 0)).toBe(true);
    expect(text.lit(0, 0)).toBe(false);
    expect(text.lit(8, 0)).toBe(true);
    expect(text.lit(-1, 0)).toBe(false);
    expect(text.lit(2, 7)).toBe(false);
  });
});

describe('scroll', () => {
  const text = rasterize('I');
  const p = scroll(b, text, 0xff9a2e);
  const steps = text.cols + COLS;

  it('starts and ends with the sign dark', () => {
    for (const led of b.dots) {
      expect(p.at(0, led, setting).lit).toBe(0);
      expect(p.at(0.9999, led, setting).lit).toBe(0);
    }
  });

  it('has the text at the left edge once it has moved the sign’s width', () => {
    const phase = (COLS + 0.5) / steps;
    expect(p.at(phase, dot(2, 0), setting).lit).toBe(1);
    expect(p.at(phase, dot(0, 0), setting).lit).toBe(0);
    expect(p.duration).toBe(steps * STEP_MS);
  });
});

describe('hold', () => {
  const p = hold(b, rasterize('I'), 0xff9a2e);
  const at = (ms: number, x: number, y: number) => p.at(ms / HOLD_MS, dot(x, y), setting).lit;

  it('centers the text and flashes it in the middle of its time', () => {
    expect(at(500, 39, 0)).toBe(1);
    expect(at(1300, 39, 0)).toBe(1);
    expect(at(1500, 39, 0)).toBe(0);
    expect(at(500, 10, 0)).toBe(0);
  });
});

describe('play', () => {
  it('places each step where the one before it ends', () => {
    const m = mix<Subject, Pose>(KIT);
    const steps = [
      { how: 'hold', text: 'I', hex: 0xff9a2e },
      { how: 'scroll', text: 'I', hex: 0x6dff5a },
    ] as const;
    play(m, b, steps);
    m.sync(0);
    m.sync(1000);
    expect(m.probe(dot(39, 0)).lit).toBe(1);
    expect(m.probe(dot(2, 0)).lit).toBe(0);
    m.sync(length(b, steps[0]) + (COLS + 0.5) * STEP_MS);
    expect(m.probe(dot(2, 0)).lit).toBe(1);
    expect(m.probe(dot(39, 0)).lit).toBe(0);
  });
});

describe('board', () => {
  it('stacks lines of text a dot apart, centered, past one line', () => {
    const big = board(20, 17);
    const rowAt = (y: number) => {
      const led = big.dots[y * 20] as Led;
      return led.kind === 'dot' ? led.row : Number.NaN;
    };
    expect(big.dots).toHaveLength(340);
    expect([0, 1, 7, 8, 9, 15, 16].map(rowAt)).toEqual([-1, 0, 6, -1, 0, 6, -1]);
  });

  it('rings the sign with bulbs two pitches apart', () => {
    const small = board(10, 7);
    expect(small.bulbs.length).toBeGreaterThan(10);
    for (const bulb of small.bulbs) {
      const outside = bulb.x < 0 || bulb.x > 9 || bulb.y < 0 || bulb.y > 6;
      expect(outside).toBe(true);
    }
  });
});

describe('chase', () => {
  it('lights every third bulb through its cell, stepping one bulb a beat', () => {
    const m = mix<Subject, Pose>(KIT);
    m.cue({ patch: chase, subjects: b.cells, loop: true });
    for (let beat = 0; beat < 3; beat++) {
      m.sync(beat * CHASE_MS + CHASE_MS / 2);
      b.bulbs.forEach((bulb, j) => {
        const shown = m.probe(b.cells[b.cellOf[j] as number] as Subject).lit;
        const i = bulb.kind === 'bulb' ? bulb.i : -1;
        expect(shown).toBe((i + 3 - beat) % 3 === 0 ? 1 : 0.1);
      });
    }
  });
});
