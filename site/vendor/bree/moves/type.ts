import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import type { Placed } from '../orders.js';
import type { Values } from '../params.js';
import { move, on } from './move.js';
import { type Lookup, moveShader } from './shader.js';

/** How long the cursor stays on, or off, as it blinks. */
const BLINK = 220;

const TYPE_PARAMS = {
  ms: {
    label: 'letter time',
    min: 30,
    max: 600,
    step: 10,
    value: 110,
    unit: 'ms',
    about: 'How long each letter takes to type. Higher types more slowly.',
  },
  cursor: {
    label: 'cursor',
    choices: ['block', 'line', 'off'],
    value: 'block',
    about:
      'What stands where the next letter lands: a block as wide as the letter, a single column, or nothing.',
  },
  pace: {
    label: 'pace',
    choices: ['time', 'input'],
    value: 'time',
    about:
      'Time takes a letter time per letter. Input waits for a press before each letter: a key in the lab, the sign’s step() anywhere else.',
  },
} as const;
type Typing = Values<typeof TYPE_PARAMS>;

/**
 * `typing`'s draw at `back` 0, and backward at `back` 1, reading which letter each dot of the text
 * belongs to from `owner`, and where the cursor stands before each letter from `slots`.
 */
const TYPING = moveShader({
  params: ['left', 'n', 'letter', 'total', 'cursor', 'top', 'bottom', 'back'],
  wgsl: `if (row >= 0.0) {
  let t = select(phase, 1.0 - phase, params.back > 0.5) * params.total;
  let x = subject.x - params.left;
  let typed = min(params.n, floor(t / params.letter));
  let level = table_bitmap(x, row);
  if (level > 0.0 && table_owner(x, row) < typed) {
    lit = level;
  } else if (params.cursor > 0.5 && row >= params.top && row <= params.bottom && t >= params.letter * 0.5) {
    let after = t - params.n * params.letter;
    let off = after >= 0.0 && (floor(after / ${BLINK}.0) % 2.0 == 1.0 || after >= ${4 * BLINK}.0);
    let sx = table_slots(0.0, typed);
    lit = select(0.0, 1.0, !off && x >= sx && x < sx + table_slots(1.0, typed));
  }
}`,
  at(phase, d, p, tables) {
    const { bitmap, rows, owner, slots } = tables as Record<
      'bitmap' | 'rows' | 'owner' | 'slots',
      Lookup
    >;
    const [n, letter] = [p.n as number, p.letter as number];
    const row = rows(0, d.y) - 1;
    if (row < 0) return 0;
    const t = (p.back ? 1 - phase : phase) * (p.total as number);
    const x = d.x - (p.left as number);
    const typed = Math.min(n, Math.floor(t / letter));
    const level = bitmap(x, row);
    if (level > 0 && owner(x, row) < typed) return level;
    if (!p.cursor || row < (p.top as number) || row > (p.bottom as number) || t < letter / 2)
      return 0;
    const after = t - n * letter;
    if (after >= 0 && (Math.floor(after / BLINK) % 2 === 1 || after >= 4 * BLINK)) return 0;
    const sx = slots(0, typed);
    return x >= sx && x < sx + slots(1, typed) ? 1 : 0;
  },
});

/**
 * The message typed out a letter at a time, `t` ms in: a lit cursor standing where the next letter
 * lands and, once the last is down, blinking twice before it goes.
 */
function typing(at: Placed, p: Typing) {
  const { text } = at;
  const n = text.letters.length;
  const cursor = p.cursor !== 'off';
  const ms = Math.max(1, n * p.ms + (cursor ? 4 * BLINK : 0));
  const last = text.letters[n - 1];
  const widths = text.letters.map((s) => s.width - 1).sort((a, b) => a - b);
  const typical = Math.max(1, widths[Math.floor(widths.length / 2)] ?? 3);
  /** The columns the cursor covers standing before letter `k`. */
  const slot = (k: number) => {
    const s = text.letters[k];
    const x = s ? s.x : last ? last.x + last.width : 0;
    const width = p.cursor === 'line' ? 1 : s ? Math.max(1, s.width - 1) : typical;
    return { x, width };
  };
  const top = text.above;
  const bottom = text.rows - 1 - text.below;
  /** The letter a dot of the text belongs to, the nearest where it lies outside every span. */
  const ownerOf = (x: number, row: number) => {
    const k = text.letterAt(x, row);
    return k >= 0 ? k : x < (text.letters[0]?.x ?? 0) ? 0 : n - 1;
  };
  /** The pass as a shader patch, played forward or, with `back`, backward. */
  const shader = (back: boolean) => {
    const width = Math.max(1, text.cols);
    const owner = new Float32Array(width * Math.max(1, text.rows));
    for (let row = 0; row < text.rows; row++)
      for (let x = 0; x < text.cols; x++) owner[row * width + x] = ownerOf(x, row);
    const places = Array.from({ length: n + 1 }, (_, k) => slot(k)).flatMap((s) => [s.x, s.width]);
    return TYPING(
      at,
      ms,
      {
        left: at.left,
        n,
        letter: p.ms,
        total: ms,
        cursor: cursor ? 1 : 0,
        top,
        bottom,
        back: back ? 1 : 0,
      },
      {
        owner: { width, height: Math.max(1, text.rows), data: owner },
        slots: { width: 2, height: n + 1, data: places },
      },
    );
  };
  return {
    ms,
    shader,
    /** Mid-letter with `k` letters down, for `k` from 0, and the last letter down. */
    rests: p.pace === 'input' ? Array.from({ length: n }, (_, k) => k * p.ms + p.ms / 2) : null,
    release: n * p.ms,
    draw(t: number, led: Led) {
      const row = at.rowOf(led);
      if (row < 0) return on(false);
      const x = led.x - at.left;
      const typed = Math.min(n, Math.floor(t / p.ms));
      const level = text.level(x, row);
      if (level > 0 && ownerOf(x, row) < typed) return on(level);
      if (!cursor || row < top || row > bottom || t < p.ms / 2) return on(false);
      // Solid while typing, then on, off, on, off.
      const after = t - n * p.ms;
      if (after >= 0 && Math.floor(after / BLINK) % 2 === 1) return on(false);
      if (after >= 4 * BLINK) return on(false);
      const s = slot(typed);
      return on(x >= s.x && x < s.x + s.width);
    },
  };
}

/** Letters typed on one at a time behind a cursor. */
export const typeOn = move({
  name: 'type-on',
  about: 'Letters appear one at a time left to right behind a cursor, which blinks and goes.',
  slot: 'enter',
  params: TYPE_PARAMS,
  rests(at, p) {
    const { rests, release } = typing(at, p);
    return rests && { at: rests, release };
  },
  patch(at, p) {
    const { ms, draw } = typing(at, p);
    return patch<Led, Pose>(ms, (phase, led) => draw(phase * ms, led), { writes: ['lit'] });
  },
  shader: (at, p) => typing(at, p).shader(false),
});

/** Letters backspaced off right to left, the cursor blinking first. */
export const typeOff = move({
  name: 'type-off',
  about: 'A cursor blinks after the message, then backspaces it away right to left.',
  slot: 'exit',
  params: TYPE_PARAMS,
  rests(at, p) {
    const { ms, rests } = typing(at, p);
    if (!rests) return null;
    const n = rests.length;
    // Type-on's rests backward from the whole message, with the cursor on after it where there is one.
    const full = n * p.ms + (p.cursor === 'off' ? 0 : BLINK / 2);
    const typed = [full, ...rests.slice(1).reverse()];
    return { at: typed.map((t) => ms - t), release: ms - p.ms / 2 };
  },
  patch(at, p) {
    const { ms, draw } = typing(at, p);
    return patch<Led, Pose>(ms, (phase, led) => draw((1 - phase) * ms, led), { writes: ['lit'] });
  },
  shader: (at, p) => typing(at, p).shader(true),
});
