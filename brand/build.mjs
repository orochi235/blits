// Builds every blits logo file from the dot grid below. Run: node brand/build.mjs
// SVGs need nothing; PNGs need `resvg` on PATH, favicon.ico needs `magick`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COLOR, DOT, MARK_FILL, compose } from './glyphs.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');

function dots(grid, cell, ox, oy, fill) {
  return grid.lit.map(([c, r]) =>
    `<circle cx="${+(ox + (c + 0.5) * cell).toFixed(3)}" cy="${+(oy + (r + 0.5) * cell).toFixed(3)}" r="${+(cell * DOT).toFixed(3)}"/>`,
  ).join('').replace(/^/, `<g fill="${fill}">`) + '</g>';
}

const GLOW = '<filter id="glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;

const word = compose('blits');
const mark = compose('b');
const CELL = 10;

const files = {};

// Wordmarks on no background, trimmed to the dots.
for (const [name, fill] of [['green', COLOR.green], ['black', COLOR.ink], ['white', COLOR.white]]) {
  files[`wordmark-${name}.svg`] = svg(word.cols * CELL, word.rows * CELL, dots(word, CELL, 0, 0, fill));
}
// Wordmark on its dark panel, with and without glow.
{
  const pad = 2 * CELL, w = word.cols * CELL + 2 * pad, h = word.rows * CELL + 2 * pad;
  const bg = `<rect width="${w}" height="${h}" fill="${COLOR.panel}"/>`;
  files['wordmark-panel.svg'] = svg(w, h, bg + dots(word, CELL, pad, pad, COLOR.green));
  files['wordmark-panel-glow.svg'] = svg(w, h, `<defs>${GLOW}</defs>` + bg + dots(word, CELL, pad, pad, COLOR.green).replace('<g ', '<g filter="url(#glow)" '));
}
// The mark: the wordmark's own b, centered in a square tile.
{
  const S = 100, cell = (S * MARK_FILL) / mark.rows, ox = (S - mark.cols * cell) / 2, oy = (S - mark.rows * cell) / 2;
  const tile = (fill, r) => `<rect width="${S}" height="${S}" rx="${r}" fill="${fill}"/>`;
  files['mark-panel.svg'] = svg(S, S, tile(COLOR.panel, 22) + dots(mark, cell, ox, oy, COLOR.green));
  files['mark-panel-square.svg'] = svg(S, S, tile(COLOR.panel, 0) + dots(mark, cell, ox, oy, COLOR.green));
  files['mark-panel-circle.svg'] = svg(S, S, tile(COLOR.panel, 50) + dots(mark, cell, ox, oy, COLOR.green));
  files['mark-black.svg'] = svg(S, S, dots(mark, cell, ox, oy, COLOR.ink));
  files['mark-white.svg'] = svg(S, S, dots(mark, cell, ox, oy, COLOR.white));
  files['mark-green.svg'] = svg(S, S, dots(mark, cell, ox, oy, COLOR.green));
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'png'), { recursive: true });
const names = Object.keys(files);
names.forEach((f, k) => { writeFileSync(join(OUT, f), files[f]); console.log(`${k + 1}/${names.length} ${f}`); });

const has = (bin) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
if (!has('resvg')) { console.log('resvg not found; skipped PNGs and favicon'); process.exit(0); }

const png = (src, out, args) => execFileSync('resvg', [...args, join(OUT, src), join(OUT, 'png', out)]);
const MARK_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
for (const s of MARK_SIZES) png('mark-panel.svg', `mark-panel-${s}.png`, ['-w', String(s), '-h', String(s)]);
for (const s of [180, 512]) png('mark-panel-square.svg', `mark-panel-square-${s}.png`, ['-w', String(s), '-h', String(s)]);
for (const z of [1, 2, 4]) {
  png('wordmark-panel.svg', `wordmark-panel@${z}x.png`, ['--zoom', String(z)]);
  png('wordmark-panel-glow.svg', `wordmark-panel-glow@${z}x.png`, ['--zoom', String(z)]);
  for (const n of ['green', 'black', 'white']) png(`wordmark-${n}.svg`, `wordmark-${n}@${z}x.png`, ['--zoom', String(z)]);
}
console.log(`png: ${MARK_SIZES.length + 2 + 15} files`);

if (has('magick')) {
  execFileSync('magick', [16, 32, 48].map(s => join(OUT, 'png', `mark-panel-${s}.png`)).concat(join(OUT, 'favicon.ico')));
  console.log('favicon.ico');
} else console.log('magick not found; skipped favicon.ico');
