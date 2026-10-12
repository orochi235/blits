// Reduces what bench/reach.sh printed to medians over its rounds: each row's ms/frame beside the
// glow over every subject and the voice under it, then what one subject entering or leaving costs.
//   node bench/reachcost.mjs <file holding reach.sh's output>
// A pair is one subject leaving and one entering in a frame: a `<way>:<K>` row less `<way>:0`, by
// K. Entering and leaving apart come from a `<way>/<K>` row, each from one process: its frame of
// K entering less the still frame after it, and the same for leaving, so both sides of a
// difference read the same number of subjects in reach.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (file === undefined) throw new Error('usage: node bench/reachcost.mjs <reach.sh output>');
const runs = new Map();
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const row = /^r\d+\s+(\S+)\s+N=\s*\d+ [VW]=\s*\d+\s+([\d.]+) ms\/frame/.exec(line);
  if (row === null) continue;
  const turns = /enter\s+([\d.]+)\s+after\s+([\d.]+)\s+leave\s+([\d.]+)\s+after\s+([\d.]+)/.exec(
    line,
  );
  const got = runs.get(row[1]) ?? [];
  runs.set(row[1], got);
  got.push({
    ms: Number(row[2]),
    calls: Number(/calls\s+([\d.]+)/.exec(line)?.[1] ?? Number.NaN),
    kb: Number(/([\d.]+) kB\/frame/.exec(line)?.[1] ?? Number.NaN),
    turns: turns === null ? null : turns.slice(1).map(Number),
  });
}
const median = (xs) => {
  const s = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[(s.length - 1) >> 1];
};
const of = (name, pick = (r) => r.ms) => median((runs.get(name) ?? []).map(pick));
const ms = (x) => (Number.isNaN(x) ? '–' : x.toFixed(3)).padStart(7);
const ns = (x) => (Number.isNaN(x) ? '–' : x.toFixed(0)).padStart(7);
const pct = (x) => (Number.isNaN(x) ? '–' : `${(x * 100).toFixed(0)}%`).padStart(5);
const rounds = Math.min(...[...runs.values()].map((r) => r.length));
console.log(`${runs.size} rows, ${rounds} rounds at least; medians`);

const READS = [
  ['', 'probe'],
  ['-', 'probe, lanes off'],
  ['^', 'pull'],
];
const WAYS = ['part', 'drop', 'own'];
const KS = [0, 2, 20, 200];

console.log('\nms/frame, and the share of the glow over every subject (glow less glowbase) saved');
console.log(
  `${'read'.padEnd(17)} ${'way'.padEnd(4)} ${'base'.padStart(7)} ${'glow'.padStart(7)}` +
    KS.map((k) => `${`K=${k}`.padStart(8)} ${'saved'.padStart(5)}`).join(''),
);
for (const [mark, read] of READS) {
  const base = of(`glowbase${mark}`);
  const glow = of(`glow${mark}`);
  for (const way of WAYS) {
    if (!runs.has(`${way}:0${mark}`)) continue;
    const cells = KS.map((k) => {
      const at = of(`${way}:${k}${mark}`);
      return ` ${ms(at)} ${pct((glow - at) / (glow - base))}`;
    });
    console.log(`${read.padEnd(17)} ${way.padEnd(4)} ${ms(base)} ${ms(glow)}${cells.join('')}`);
  }
}

console.log('\nns a pair (one subject leaving and one entering), and of that inside the calls');
console.log(
  `${'read'.padEnd(17)} ${'way'.padEnd(4)}` +
    KS.slice(1)
      .map((k) => `${`K=${k}`.padStart(8)} ${'calls'.padStart(7)}`)
      .join(''),
);
for (const [mark, read] of READS)
  for (const way of WAYS) {
    if (!runs.has(`${way}:0${mark}`)) continue;
    const still = of(`${way}:0${mark}`);
    const cells = KS.slice(1).map((k) => {
      const name = `${way}:${k}${mark}`;
      return ` ${ns(((of(name) - still) * 1e6) / k)} ${ns((of(name, (r) => r.calls) * 1e6) / k)}`;
    });
    console.log(`${read.padEnd(17)} ${way.padEnd(4)}${cells.join('')}`);
  }

console.log('\nns a subject entering and leaving, apart; `still` is ms/frame after K left');
console.log(
  `${'read'.padEnd(17)} ${'way'.padEnd(4)} ${'K'.padStart(3)} ${'enter'.padStart(7)} ${'leave'.padStart(7)}` +
    ` ${'both'.padStart(7)} ${'still'.padStart(7)} ${'K=0'.padStart(7)}`,
);
for (const [mark, read] of READS)
  for (const way of WAYS)
    for (const k of [20, 200]) {
      const name = `${way}/${k}${mark}`;
      if (!runs.has(name)) continue;
      const enter = of(name, (r) => ((r.turns[0] - r.turns[1]) * 1e6) / k);
      const leave = of(name, (r) => ((r.turns[2] - r.turns[3]) * 1e6) / k);
      console.log(
        `${read.padEnd(17)} ${way.padEnd(4)} ${String(k).padStart(3)} ${ns(enter)} ${ns(leave)}` +
          ` ${ns(enter + leave)} ${ms(of(name, (r) => r.turns[3]))} ${ms(of(`${way}:0${mark}`))}`,
      );
    }
