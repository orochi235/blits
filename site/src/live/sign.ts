import { compose } from '@brand/glyphs.js';
import { marginOf } from 'bree';
import { GREEN } from '../explainers/hues';

export const WORD = compose('blits');

/**
 * Blank rows the face carries above the word, so the sign reaches the top of the page, and below
 * it, where the sign runs on behind the rail's links and search box.
 */
export const ABOVE = 3;
export const BELOW = 13;

/** The blank dots the logo keeps round its message, and the empty frame bree keeps round its dots. */
const PAD = marginOf(false);
const FRAME = marginOf(false);

/** The sign's dots, as bree is asked for them: the word's glyph and a blank column after it, padded. */
export const SIGN = {
  cols: WORD.cols + 2 + 2 * PAD,
  rows: ABOVE + WORD.rows + BELOW + 2 * PAD,
} as const;

/** bree's housing and its sockets, and a dot's diameter in pitches: render/bloom-params, render/lights. */
const HOUSING = '#0d0a08';
const SOCKET = '#21150f';
const LAMP = 0.72;

/**
 * The sign as it stands before its script runs, down to the foot of the word, one unit a pitch: the
 * word in green where the live sign draws it, on the dark housing with every socket (`panel`), or
 * on nothing.
 */
export function still(panel: boolean): string {
  const across = SIGN.cols + 2 * FRAME;
  const down = 2 * (FRAME + PAD) + ABOVE + WORD.rows;
  const dot = (x: number, y: number) => `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="${LAMP / 2}"/>`;
  const left = FRAME + PAD + 1;
  const top = FRAME + PAD + ABOVE;
  const lit = WORD.lit.map(([c, r]) => dot(left + c, top + r)).join('');
  let housing = '';
  if (panel) {
    const sockets: string[] = [];
    for (let y = FRAME; y < down; y++)
      for (let x = FRAME; x < across - FRAME; x++) sockets.push(dot(x, y));
    housing = `<rect width="${across}" height="${down}" fill="${HOUSING}"/><g fill="${SOCKET}">${sockets.join('')}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${across} ${down}">${housing}<g fill="#${GREEN.toString(16)}">${lit}</g></svg>`;
}
