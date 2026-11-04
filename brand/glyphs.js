// The blits logo's dot grid: the one definition the build script and <blits-logo> both read.

export const COLOR = { green: '#B2E81B', ink: '#111111', white: '#FFFFFF', panel: '#0C0F0A' };

// 1 is a lit dot. Every letter is followed by one empty column, less its kern.
// The l, i and t carry a hook that sits in that gap; the l's top serif sits in the gap before it.
export const GLYPHS = {
  b: ['11..', '11..', '111.', '11.1', '11.1', '11.1', '.11.'],
  l: ['111.', '.11.', '.11.', '.11.', '.11.', '.11.', '..11'],
  i: ['11.', '...', '11.', '11.', '11.', '11.', '.11'],
  t: ['11.', '11.', '111', '11.', '11.', '11.', '.11'],
  s: ['....', '....', '.111', '11..', '1111', '...1', '111.'],
};
export const KERN = { l: -1, i: -1, t: -1, s: -1 };

// Dot radius as a fraction of the cell.
export const DOT = 0.46;

/** Lays out `text` (letters from GLYPHS) as a grid; `lit` holds [col, row, letterIndex] per dot. */
export function compose(text) {
  const rows = GLYPHS[text[0]].length;
  const starts = [];
  let x = 0;
  [...text].forEach((ch, k) => {
    if (k) x += 1 + (KERN[ch] ?? 0);
    starts.push(x);
    x += GLYPHS[ch][0].length;
  });
  const lit = [];
  [...text].forEach((ch, k) => GLYPHS[ch].forEach((row, r) => [...row].forEach((v, q) => {
    if (v === '1') lit.push([starts[k] + q, r, k]);
  })));
  return { cols: x, rows, lit };
}
