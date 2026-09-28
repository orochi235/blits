#!/usr/bin/env node
// Draws docs/concept-map.svg: the roles, what contains what, and the path a value takes to one
// item in one frame. Labels come from the current picks, so the map follows the naming rather
// than freezing it. Layout is hand-placed; the data only supplies words.
//
//   node docs/concept-map.mjs [job.json] [out.svg]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
const jobPath = process.argv[2] || join(here, '2026-09-15-vocabulary.json');
const outPath = process.argv[3] || join(here, 'concept-map.svg');
const job = JSON.parse(readFileSync(jobPath, 'utf8'));
let picks = {};
try {
  picks = JSON.parse(readFileSync(jobPath.replace(/\.json$/, '.picks.json'), 'utf8')).picks || {};
} catch {}

// Verbs are picked under a v- prefix and carry their incumbent under the bare key.
const incumbent = Object.fromEntries([
  ...job.roles.map((r) => [r.key, r.was]),
  ...(job.verbs || []).map((v) => [`v-${v.key}`, v.was.replace(/^.*\./, '').replace(/\(.*$/, '')]),
]);
const word = (key) => picks[key] || incumbent[key] || key;
const was = (key) => (incumbent[key] === word(key) ? null : incumbent[key]);
const an = (key) => (/^[aeiou]/i.test(word(key)) ? 'an' : 'a');

const warnings = [];
const esc = (s) => String(s).replace(/&(?!#?\w+;)/g, '&amp;');

const out = [];
const put = (s) => out.push(s);
// Rough advance width, enough to catch a line running out of its box. Bold and <tspan> markup are
// charged at their visible length only.
const visible = (s) => s.replace(/<[^>]+>/g, '');
const wide = (s, size) => visible(s).length * size * 0.52;

const box = (x, y, w, h, cls = '') => put(`<rect class="box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>`);
const text = (x, y, s, cls = 'row', limit = null) => {
  const size = cls.includes('head') ? 14.5 : cls.includes('title') ? 20 : 13;
  if (limit && wide(s, size) > limit) warnings.push(`${Math.round(wide(s, size))}px in ${limit}px: ${visible(s).slice(0, 48)}`);
  put(`<text class="${cls}" x="${x}" y="${y}">${esc(s)}</text>`);
};
const head = (key, tail, x, y, limit) =>
  text(x, y, `<tspan class="strong">${word(key)}</tspan>${was(key) ? ` <tspan class="was">(${was(key)})</tspan>` : ''}${tail}`, 'head', limit);
const rows = (x, y, lines, limit, cls = 'row', step = 21) => lines.forEach((l, i) => text(x, y + i * step, l, cls, limit));
const arrow = (d, label, lx, ly) => {
  put(`<path class="edge" d="${d}" marker-end="url(#tip)"/>`);
  if (label) text(lx, ly, label, 'edgelabel');
};

const W = 1240;
const H = 968;

text(40, 44, `${job.title} — what contains what, and what reaches ${an('item')} ${word('item')}`, 'title');
text(40, 66, `Names are the current picks, with the incumbent in parentheses. Generated from ${basename(jobPath)}.`, 'sub');

// ── host ─────────────────────────────────────────────────────────────────────
box(40, 92, 1160, 46, 'host');
head('host', ` — owns the frame loop: ${word('v-step')}s each ${word('mix')} once a frame, and holds every ${word('handle')}`, 62, 122, 1120);

// ── system ───────────────────────────────────────────────────────────────────
box(40, 166, 1160, 404, 'frame');
text(62, 194, `${word('system')} — one complete area. klieg runs three: motion, effects, lighting`, 'frametag');

// left column
box(68, 212, 248, 172, 'panel');
head('table', '', 88, 240, 208);
rows(88, 262, [`what ${an('item')} ${word('item')} can move on`], 208);
rows(88, 292, [
  `<tspan class="chip">${word('channel')}</tspan> position · sum`,
  `<tspan class="chip">${word('channel')}</tspan> gain · mul`,
  `<tspan class="chip">${word('channel')}</tspan> color · last`,
], 208);
text(88, 366, `<tspan class="strong">${word('rest')}</tspan> — nothing happening`, 'row', 208);

box(68, 400, 248, 72, 'panel');
head('item', '', 88, 428, 208);
rows(88, 452, [`driven: a letter, a part`], 208);

box(68, 488, 248, 72, 'panel');
head('signal', ' — from outside', 88, 516, 208);
rows(88, 540, [`0 to 1, per ${word('item')}, per frame`], 208);

// mix
box(352, 212, 848, 336, 'panel');
head('mix', ` — every ${word('track')} playing, over one ${word('table')}`, 374, 240, 800);

box(396, 268, 392, 180, 'ghost');
box(388, 260, 392, 180, 'ghost');
box(380, 252, 392, 180, 'card');
head('track', ` — one ${word('piece')}, playing`, 400, 280, 352);
rows(400, 306, [
  `<tspan class="strong">${word('piece')}</tspan>(${word('phase')}, ${word('item')}, ${word('context')}) → ${word('offset')}`,
  `clock — start · rate · ${word('period')} ⇒ ${word('phase')}`,
  `<tspan class="strong">${word('weight')}</tspan> — ramp(now), or ${an('signal')} ${word('signal')}`,
  `target — where it is heading`,
], 352);

box(800, 252, 372, 92, 'card dashed');
head('group', ' — alternatives in time', 820, 280, 332);
rows(820, 304, [`weights capped to sum to 1`, `klieg's enter · active · exit`], 332);

box(800, 360, 372, 94, 'card');
head('engine', ' — computes the fold', 820, 388, 332);
rows(820, 412, [`one ships: the mixer; the seam is the interface`], 332);
text(820, 436, `${word('engine')}(${word('mix')}, now) = ${word('item')} ↦ ${word('sample')}`, 'row mono', 332);

box(800, 470, 372, 62, 'card');
head('handle', ' — the live controls', 820, 498, 332);
rows(820, 520, [`start · rate · ${word('weight')} · ${word('v-seek')} · ${word('v-stop')}`], 332);

// edges inside the system
arrow('M 316 276 H 372', 'declares', 318, 268);
arrow('M 316 432 H 372', 'drives', 322, 424);
arrow('M 316 524 L 372 470', `may be ${an('weight')} ${word('weight')}`, 190, 578);

// ── the value path ───────────────────────────────────────────────────────────
text(40, 620, `One ${word('item')}, one frame`, 'section');

box(68, 636, 300, 108, 'panel');
head('offset', ` ⊂ ${word('table')}`, 88, 664, 260);
rows(88, 688, [`what one ${word('piece')} says about`, `one ${word('item')} at one instant`], 260);

box(440, 636, 300, 108, 'panel');
head('contribution', '', 460, 664, 260);
rows(460, 688, [`= ${word('weight')} ⊙ ${word('offset')}`, `pulled toward ${word('rest')} by how`, `much of the ${word('track')} is on`], 260);

box(816, 636, 384, 108, 'panel');
head('sample', '', 836, 664, 344);
rows(836, 688, [`= ${word('rest')} ⊕ Σ ${word('contribution')}`, `everything reaching that ${word('item')},`, `folded by each channel's own rule`], 344);

arrow('M 588 440 V 600 H 218 V 630', `returns one, per ${word('item')}`, 600, 480);
arrow('M 368 690 H 434', `× ${word('weight')}`, 372, 682);
arrow('M 740 690 H 810', 'Σ', 768, 682);

// ── sources ──────────────────────────────────────────────────────────────────
text(40, 770, `Where ${word('track')}s come from`, 'section');

box(68, 786, 540, 92, 'panel dashed');
head('source', ' — whatever decides one should exist', 88, 814, 500);
rows(88, 838, [`a handler on an event, a ${word('sequence')} handing over,`, `${word('v-add')}s and gets back ${an('handle')} ${word('handle')}`], 500);

box(660, 786, 540, 92, 'panel dashed');
head('score', ` — the ${word('source')} the app keeps`, 680, 814, 500);
rows(680, 838, [`the whole plan: timings and the cast`, `blits never reads one; it only knows it is there`], 500);

arrow('M 340 782 V 742', `${word('v-add')}`, 348, 762);

text(40, 906, `A ${word('system')} declares one ${word('table')} and one kind of ${word('item')}; its ${word('mix')} runs ${word('track')}s over that ${word('table')}; each ${word('track')} is one ${word('piece')} with its own clock and ${word('weight')}.`, 'note');
text(40, 928, `Nothing is computed until it is asked for: ${word('v-sample')} folds that ${word('item')}'s ${word('contribution')}s at the current reading, and ${an('item')} ${word('item')} nobody asks about costs nothing.`, 'note');
text(40, 950, `Two ${word('system')}s never share a ${word('mix')}, so a ${word('track')} belongs to exactly one.`, 'note');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-sans-serif, -apple-system, 'Helvetica Neue', sans-serif">
<style>
  :root {
    --bg: #fbfaf7; --ink: #1c1b1f; --muted: #6d6b73; --line: #cbc8c0;
    --panel: #ffffff; --card: #f3f0e9; --accent: #9a6a12; --accent-bg: #f7eed9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #15141a; --ink: #e9e6e0; --muted: #9a97a1; --line: #3d3b46;
      --panel: #1d1c23; --card: #262430; --accent: #e0a94a; --accent-bg: #2b2418;
    }
  }
  .bg { fill: var(--bg); }
  .box { fill: var(--panel); stroke: var(--line); stroke-width: 1; }
  .frame { fill: none; stroke: var(--accent); stroke-dasharray: 6 5; }
  .host { fill: var(--accent-bg); stroke: var(--accent); }
  .card { fill: var(--card); }
  .ghost { fill: var(--card); opacity: 0.4; }
  .dashed { stroke-dasharray: 5 4; }
  .edge { fill: none; stroke: var(--muted); stroke-width: 1.4; }
  text { fill: var(--ink); font-size: 13px; }
  .title { font-size: 20px; font-weight: 650; }
  .sub, .note { fill: var(--muted); font-size: 13px; }
  .section { fill: var(--accent); font-size: 12px; font-weight: 650; letter-spacing: 0.1em; text-transform: uppercase; }
  .frametag { fill: var(--accent); font-size: 13px; }
  .head { font-size: 14.5px; }
  .row { fill: var(--muted); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .strong { font-weight: 650; fill: var(--ink); }
  .was { fill: var(--muted); font-size: 11px; font-weight: 400; }
  .chip { fill: var(--accent); font-size: 11px; letter-spacing: 0.04em; }
  .edgelabel { fill: var(--muted); font-size: 11px; }
</style>
<defs><marker id="tip" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
  <path d="M 0 0 L 10 5 L 0 10 z" fill="#9a97a1"/>
</marker></defs>
<rect class="bg" x="0" y="0" width="${W}" height="${H}"/>
${out.join('\n')}
</svg>
`;

writeFileSync(outPath, svg);
console.log(`${outPath}  ${job.roles.length} roles, ${Object.keys(picks).length} picks`);
for (const w of warnings) console.log(`  overflows — ${w}`);
