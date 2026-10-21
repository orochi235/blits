// Reduces what bench/ab.sh printed to one line a row: each revision's median ms/frame over its
// rounds, the second over the first, and each one's median kB/frame where the rows have it; then
// the geometric mean of the ratios. `U` is the Mann-Whitney rank statistic over the two sides' runs,
// the smaller of the two; at 7 rounds a side it is under 9 for p < 0.05, at 9 under 18.
//   node bench/medians.mjs <file holding ab.sh's output>
// LEDGER="<what the change does>" also appends each row to bench/ledger.tsv, the record of what
// each change measured; LEDGER_NODE names the node, LEDGER_REV the commit standing for `.`, and
// LEDGER_FRAMES the FRAMES the run used (300 unset). Keep the output itself in bench/runs/ first,
// headed by a `#` line naming the node and the command: the ledger names it as the line's `raw`.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const file = process.argv[2];
if (file === undefined) throw new Error('usage: node bench/medians.mjs <ab.sh output>');
const revs = [];
const rows = new Map();
let rev = '';
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const round = /^== round \d+\/\d+ (\S+)/.exec(line);
  if (round !== null) {
    rev = round[1];
    if (!revs.includes(rev)) revs.push(rev);
    continue;
  }
  const row = /^\s*\d+\/\d+\s+(\S+)\s+N=\s*(\d+) V=(\d+)\s+([\d.]+) ms\/frame/.exec(line);
  if (row === null) continue;
  const key = `${row[1]} N=${row[2]} V=${row[3]}`;
  const kb = /([\d.]+) kB\/frame/.exec(line);
  const at = rows.get(key) ?? new Map();
  rows.set(key, at);
  const got = at.get(rev) ?? { ms: [], kb: [] };
  at.set(rev, got);
  got.ms.push(Number(row[4]));
  if (kb !== null) got.kb.push(Number(kb[1]));
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[(s.length - 1) >> 1];
};
const rank = (xs, ys) => {
  let u = 0;
  for (const x of xs) for (const y of ys) u += x < y ? 1 : x === y ? 0.5 : 0;
  return Math.min(u, xs.length * ys.length - u);
};
const [a, b] = revs;
const wide = Math.max(...[...rows.keys()].map((k) => k.length));
const kbWide = 3 + Math.max(a.length, b.length, 5);
console.log(
  `${'row'.padEnd(wide)}  ${a.padStart(9)}  ${b.padStart(9)}  ${'ratio'.padStart(6)}  ${'U'.padStart(5)}` +
    `  ${`kB ${a}`.padStart(kbWide)}  ${`kB ${b}`.padStart(kbWide)}`,
);
const ledger = process.env.LEDGER;
const repo = resolve(new URL('..', import.meta.url).pathname);
const raw = relative(repo, resolve(file)).startsWith('..') ? '' : relative(repo, resolve(file));
if (ledger !== undefined && raw === '')
  console.log('note: the output is outside the repo, so the ledger line names no raw file');
const lines = [];
let logs = 0;
let n = 0;
for (const [key, at] of rows) {
  const x = at.get(a);
  const y = at.get(b);
  if (x === undefined || y === undefined) continue;
  const ratio = median(y.ms) / median(x.ms);
  logs += Math.log(ratio);
  n++;
  const u = rank(x.ms, y.ms);
  const kbOf = (r) => (r.kb.length === 0 ? '' : median(r.kb).toFixed(1));
  console.log(
    `${key.padEnd(wide)}  ${median(x.ms).toFixed(3).padStart(9)}  ${median(y.ms).toFixed(3).padStart(9)}` +
      `  ${ratio.toFixed(3).padStart(6)}  ${u.toFixed(1).padStart(5)}  ${kbOf(x).padStart(kbWide)}  ${kbOf(y).padStart(kbWide)}`,
  );
  lines.push(
    [
      new Date().toISOString().slice(0, 10),
      process.env.LEDGER_NODE ?? '',
      a,
      b === '.' ? (process.env.LEDGER_REV ?? '.') : b,
      Math.min(x.ms.length, y.ms.length),
      process.env.LEDGER_FRAMES ?? 300,
      key,
      median(x.ms).toFixed(3),
      median(y.ms).toFixed(3),
      ratio.toFixed(3),
      u.toFixed(1),
      kbOf(x),
      kbOf(y),
      ledger,
      raw,
    ].join('\t'),
  );
}
console.log(`${n} rows, geometric mean ${Math.exp(logs / n).toFixed(3)}`);
if (ledger !== undefined) {
  const path = new URL('./ledger.tsv', import.meta.url);
  const head =
    'date\tnode\tbase\trev\trounds\tframes\trow\tbase ms\tms\tratio\tU\tbase kB\tkB\tchange\traw\n';
  appendFileSync(path, (existsSync(path) ? '' : head) + lines.map((l) => `${l}\n`).join(''));
  console.log(`appended ${lines.length} rows to bench/ledger.tsv`);
}
