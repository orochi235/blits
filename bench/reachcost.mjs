// Reduces what bench/reach.sh printed to medians over its rounds: each row's frame beside the
// glow over every subject and the voice under it, then what one subject entering or leaving costs.
//   node bench/reachcost.mjs <files holding reach.sh's output...>
// Frames are read twice, by each run's median frame (`p50`) and by its mean (`ms/frame`). A pair
// is one subject leaving and one entering in a frame, or for `stale` one chain linked again: a
// `<way>:<K>` row less `<way>:0`, by K.
// Entering and leaving apart come from a `<way>/<K>` row, each from one process: its frame of K
// entering less the still frame after it, and the same for leaving, so both sides of a difference
// read the same number of subjects in reach.
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) throw new Error('usage: node bench/reachcost.mjs <reach.sh output...>');
const runs = new Map();
const num = (re, line) => Number(re.exec(line)?.[1] ?? Number.NaN);
for (const file of files)
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const row = /^r\d+\s+(\S+)\s+N=\s*\d+ [VW]=\s*\d+\s+([\d.]+) ms\/frame/.exec(line);
    if (row === null) continue;
    const turns = /enter\s+([\d.]+)\s+after\s+([\d.]+)\s+leave\s+([\d.]+)\s+after\s+([\d.]+)/.exec(
      line,
    );
    const got = runs.get(row[1]) ?? [];
    runs.set(row[1], got);
    got.push({
      mean: Number(row[2]),
      p50: num(/p50\s+([\d.]+)/, line),
      calls: num(/calls\s+([\d.]+)/, line),
      kb: num(/([\d.]+) kB\/frame/, line),
      turns: turns === null ? null : turns.slice(1).map(Number),
    });
  }
const median = (xs) => {
  const s = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[(s.length - 1) >> 1];
};
const of = (name, pick) => median((runs.get(name) ?? []).map(pick));
const ms = (x) => (Number.isNaN(x) ? '–' : x.toFixed(3)).padStart(7);
const ns = (x) => (Number.isNaN(x) ? '–' : x.toFixed(0)).padStart(7);
const pct = (x) => (Number.isNaN(x) ? '–' : `${(x * 100).toFixed(0)}%`).padStart(5);
const rounds = [...runs.values()].map((r) => r.length);
console.log(`${runs.size} rows, ${Math.min(...rounds)}–${Math.max(...rounds)} rounds; medians`);

const READS = [
  ['', 'probe'],
  ['-', 'probe, lanes off'],
  ['^', 'pull'],
];
const WAYS = ['part', 'drop', 'own', 'stale'];
const KS = [0, 2, 20, 200];
const lead = (read, way) => `${read.padEnd(17)} ${way.padEnd(4)}`;
const head = `${'read'.padEnd(17)} ${'way'.padEnd(4)}`;

for (const [stat, title] of [
  ['p50', 'median frame'],
  ['mean', 'mean frame'],
]) {
  const pick = (r) => r[stat];
  console.log(`\n${title}, ms, and the share of what the glow adds (glow less glowbase) saved`);
  console.log(
    `${head} ${'base'.padStart(7)} ${'glow'.padStart(7)}` +
      KS.map((k) => `${`K=${k}`.padStart(8)} ${'saved'.padStart(5)}`).join(''),
  );
  for (const [mark, read] of READS) {
    const base = of(`glowbase${mark}`, pick);
    const glow = of(`glow${mark}`, pick);
    for (const way of WAYS) {
      if (!runs.has(`${way}:0${mark}`)) continue;
      const cells = KS.map((k) => {
        const at = of(`${way}:${k}${mark}`, pick);
        return ` ${ms(at)} ${pct((glow - at) / (glow - base))}`;
      });
      console.log(`${lead(read, way)} ${ms(base)} ${ms(glow)}${cells.join('')}`);
    }
  }
  console.log(
    `own:0:0, no glow at all:${READS.map(([mark, read]) => `  ${read} ${ms(of(`own:0:0${mark}`, pick)).trim()}`).join('')}`,
  );
  console.log(`\n${title}: ns a pair, one subject leaving and one entering`);
  console.log(
    head +
      KS.slice(1)
        .map((k) => `${`K=${k}`.padStart(8)}`)
        .join(''),
  );
  for (const [mark, read] of READS)
    for (const way of WAYS) {
      if (!runs.has(`${way}:0${mark}`)) continue;
      const still = of(`${way}:0${mark}`, pick);
      const cells = KS.slice(1).map(
        (k) => ` ${ns(((of(`${way}:${k}${mark}`, pick) - still) * 1e6) / k)}`,
      );
      console.log(`${lead(read, way)}${cells.join('')}`);
    }
}

console.log('\nns a pair inside the calls that move the subjects, by the median frame');
console.log(
  head +
    KS.slice(1)
      .map((k) => `${`K=${k}`.padStart(8)}`)
      .join(''),
);
for (const [mark, read] of READS)
  for (const way of WAYS) {
    if (!runs.has(`${way}:0${mark}`)) continue;
    const cells = KS.slice(1).map(
      (k) => ` ${ns((of(`${way}:${k}${mark}`, (r) => r.calls) * 1e6) / k)}`,
    );
    console.log(`${lead(read, way)}${cells.join('')}`);
  }

console.log('\nkB a frame allocated, by K');
console.log(head + KS.map((k) => `${`K=${k}`.padStart(9)}`).join(''));
for (const [mark, read] of READS)
  for (const way of WAYS) {
    if (!runs.has(`${way}:0${mark}`)) continue;
    const cells = KS.map(
      (k) =>
        ` ${of(`${way}:${k}${mark}`, (r) => r.kb)
          .toFixed(1)
          .padStart(8)}`,
    );
    console.log(`${lead(read, way)}${cells.join('')}`);
  }

console.log('\nns a subject entering and leaving, apart, by median frames; `still` is the frame');
console.log('after K left, ms, beside the K=0 row');
console.log(
  `${head} ${'K'.padStart(3)} ${'enter'.padStart(7)} ${'leave'.padStart(7)} ${'both'.padStart(7)}` +
    ` ${'still'.padStart(7)} ${'K=0'.padStart(7)}`,
);
for (const [mark, read] of READS)
  for (const way of WAYS)
    for (const k of [20, 200]) {
      const name = `${way}/${k}${mark}`;
      if (!runs.has(name)) continue;
      const enter = of(name, (r) => ((r.turns[0] - r.turns[1]) * 1e6) / k);
      const leave = of(name, (r) => ((r.turns[2] - r.turns[3]) * 1e6) / k);
      console.log(
        `${lead(read, way)} ${String(k).padStart(3)} ${ns(enter)} ${ns(leave)} ${ns(enter + leave)}` +
          ` ${ms(of(name, (r) => r.turns[3]))} ${ms(of(`${way}:0${mark}`, (r) => r.p50))}`,
      );
    }
