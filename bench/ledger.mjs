// Prints bench/ledger.tsv a row at a time: each change that measured the row, in the order they were
// recorded, with its ratio, its rank statistic, its kB a frame, and the product of the ratios so
// far. A change recorded as "(backed out) ..." is listed and left out of the product. Entries chain
// where one's base is the commit the one before kept measured, and a break in the chain is marked.
//   node bench/ledger.mjs [row filter]
import { readFileSync } from 'node:fs';

const filter = process.argv[2];
const [head, ...lines] = readFileSync(new URL('./ledger.tsv', import.meta.url), 'utf8')
  .trim()
  .split('\n');
const cols = head.split('\t');
const entries = lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v])));
const rows = new Map();
for (const e of entries) {
  if (filter !== undefined && !e.row.includes(filter)) continue;
  const list = rows.get(e.row) ?? [];
  rows.set(e.row, list);
  list.push(e);
}
for (const [row, list] of rows) {
  console.log(row);
  let total = 1;
  let last;
  for (const e of list) {
    const out = e.change.startsWith('(backed out)');
    if (!out) total *= Number(e.ratio);
    const chained = last === undefined || last === e.base ? ' ' : '~';
    if (!out) last = e.rev;
    const kb = `${e['base kB'].padStart(8)} ->${e.kB.padStart(8)} kB`;
    console.log(
      `  ${chained} ${e.date}  ${e.node.padEnd(8)} ${e.rev.padEnd(8)} ${e['base ms'].padStart(8)} ->${e.ms.padStart(8)} ms` +
        `  ${e.ratio.padStart(6)}  U ${e.U.padStart(5)}  ${kb}  ${out ? '      ' : `x${total.toFixed(3)}`}  ${e.change}`,
    );
  }
}
