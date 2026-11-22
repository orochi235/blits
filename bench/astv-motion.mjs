// Tables a bench/astv-motion.sh out dir: per case and build, the median over rounds of each run's
// mean and p50 µs a frame, then every run's mean in round order.
//   node bench/astv-motion.mjs <out dir>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const runs = new Map();
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const m = /^([^.]*)\.(.+)\.(\d+)\.json$/.exec(f);
  if (!m) continue;
  const [, kase, build, round] = m;
  const { results } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const r = Object.values(results)[0];
  const key = `${kase}\t${build}`;
  if (!runs.has(key)) runs.set(key, []);
  runs.get(key).push({ round: Number(round), mean: r.mean * 1000, p50: r.p50 * 1000 });
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const f = (x) => x.toFixed(2).padStart(7);
let last = '';
for (const key of [...runs.keys()].sort()) {
  const [kase, build] = key.split('\t');
  if (kase !== last)
    console.log(`\n${kase.replaceAll('_', ' ')}\n  build      n   mean µs    p50 µs   runs (mean)`);
  last = kase;
  const rs = runs.get(key).sort((a, b) => a.round - b.round);
  console.log(
    `  ${build.padEnd(9)} ${String(rs.length).padStart(2)}  ${f(median(rs.map((r) => r.mean)))}   ${f(median(rs.map((r) => r.p50)))}   ${rs.map((r) => r.mean.toFixed(2)).join(' ')}`,
  );
}
