// Self time inside a stop, by function: of a V8 CPU profile of bench/restart.mjs, only the samples
// under the stop's own calls (the handle's `fade` and the mix's `drop`), as µs a stop.
//   node --cpu-prof --cpu-prof-interval 50 --cpu-prof-dir=<dir> bench/restart.mjs <N>
//   node bench/stopprof.mjs <dir> <stops> [top]    stops: ROUNDS x 100, warm rounds included
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [dir, stopsArg, topArg] = process.argv.slice(2);
if (dir === undefined || stopsArg === undefined)
  throw new Error('usage: node bench/stopprof.mjs <profile dir> <stops> [top]');
const stops = Number(stopsArg);
const top = Number(topArg ?? 30);
const file = readdirSync(dir)
  .filter((f) => f.endsWith('.cpuprofile'))
  .sort()
  .at(-1);
const prof = JSON.parse(readFileSync(join(dir, file), 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const name = (n) => {
  const f = n.callFrame;
  return `${f.functionName || '(anon)'} ${f.url ? `${basename(f.url)}:${f.lineNumber + 1}` : ''}`.trim();
};
// The stop's roots: restart.mjs's `stop` closure, split by which of its two calls a sample is under.
const rootOf = (id) => {
  let half = 'other';
  for (let at = id; at !== undefined; at = parent.get(at)) {
    const n = byId.get(at);
    const f = n.callFrame;
    if (f.functionName === 'fade' && f.url.endsWith('handle.js')) half = 'fade';
    if (f.functionName === 'drop' && f.url.endsWith('drop.js')) half = 'drop';
    if (f.functionName === 'stop' && f.url.endsWith('restart.mjs')) return half;
  }
  return null;
};
const self = new Map();
const halves = new Map();
for (let i = 0; i < prof.samples.length; i++) {
  const id = prof.samples[i];
  const half = rootOf(id);
  if (half === null) continue;
  const us = prof.timeDeltas[i];
  halves.set(half, (halves.get(half) ?? 0) + us);
  const key = `${half.padEnd(5)} ${name(byId.get(id))}`;
  self.set(key, (self.get(key) ?? 0) + us);
}
const per = (us) => (us / stops).toFixed(3).padStart(7);
for (const [half, us] of halves) console.log(`${half.padEnd(5)} ${per(us)} µs a stop`);
for (const [key, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top))
  console.log(`${per(us)} µs  ${key}`);
