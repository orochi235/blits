// Reduces what bench/lineage.sh printed to a table: each row's median ms a frame under each
// revision, in the order the revisions were given, and the last over the first that ran it.
// `kB` adds a second table of median kB a frame.
//   node bench/lineage.mjs <file holding lineage.sh's output> [kB]
import { readFileSync } from 'node:fs';

const [file, extra] = process.argv.slice(2);
if (file === undefined) throw new Error('usage: node bench/lineage.mjs <lineage.sh output> [kB]');
const revs = [];
const rows = new Map();
let rev = '';
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const built = /^built (\S+)/.exec(line);
  if (built !== null) {
    revs.push(built[1]);
    continue;
  }
  const round = /^== round \d+\/\d+ (\S+)/.exec(line);
  if (round !== null) {
    rev = round[1];
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
const wide = Math.max(3, ...[...rows.keys()].map((k) => k.length));
const cell = Math.max(9, ...revs.map((r) => r.length));
const table = (field, digits) => {
  console.log(
    `${'row'.padEnd(wide)}  ${revs.map((r) => r.padStart(cell)).join('  ')}  ${'last/first'.padStart(10)}`,
  );
  for (const [key, at] of rows) {
    const values = revs.map((r) => {
      const got = at.get(r);
      return got === undefined || got[field].length === 0 ? Number.NaN : median(got[field]);
    });
    const ran = values.filter((v) => !Number.isNaN(v));
    const ratio = ran.length < 2 ? '' : (ran[ran.length - 1] / ran[0]).toFixed(3);
    console.log(
      `${key.padEnd(wide)}  ${values.map((v) => (Number.isNaN(v) ? '-' : v.toFixed(digits)).padStart(cell)).join('  ')}  ${ratio.padStart(10)}`,
    );
  }
};
console.log('ms a frame, median');
table('ms', 3);
if (extra === 'kB') {
  console.log('\nkB a frame, median');
  table('kb', 1);
}
