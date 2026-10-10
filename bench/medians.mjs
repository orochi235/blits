// Reduces what bench/ab.sh printed to one line a row: each revision's median ms/frame over its
// rounds, the second over the first, and each one's median kB/frame where the rows have it; then
// the geometric mean of the ratios.
//   node bench/medians.mjs <file holding ab.sh's output>
import { readFileSync } from 'node:fs';

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
const [a, b] = revs;
const wide = Math.max(...[...rows.keys()].map((k) => k.length));
const kbWide = 3 + Math.max(a.length, b.length, 5);
console.log(
  `${'row'.padEnd(wide)}  ${a.padStart(9)}  ${b.padStart(9)}  ${'ratio'.padStart(6)}` +
    `  ${`kB ${a}`.padStart(kbWide)}  ${`kB ${b}`.padStart(kbWide)}`,
);
let logs = 0;
let n = 0;
for (const [key, at] of rows) {
  const x = at.get(a);
  const y = at.get(b);
  if (x === undefined || y === undefined) continue;
  const ratio = median(y.ms) / median(x.ms);
  logs += Math.log(ratio);
  n++;
  const kb = (r) => (r.kb.length === 0 ? '' : median(r.kb).toFixed(1)).padStart(kbWide);
  console.log(
    `${key.padEnd(wide)}  ${median(x.ms).toFixed(3).padStart(9)}  ${median(y.ms).toFixed(3).padStart(9)}` +
      `  ${ratio.toFixed(3).padStart(6)}  ${kb(x)}  ${kb(y)}`,
  );
}
console.log(`${n} rows, geometric mean ${Math.exp(logs / n).toFixed(3)}`);
