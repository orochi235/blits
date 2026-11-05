// Self time of the named functions in a V8 .cpuprofile, split by the function that called them.
//   node bench/profcallers.mjs <file.cpuprofile> <name>...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [file, ...names] = process.argv.slice(2);
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n);
const label = (n) => {
  const f = n.callFrame;
  const where = f.url ? `${basename(f.url)}:${f.lineNumber + 1}` : '';
  return `${f.functionName || '(anonymous)'} ${where}`.trim();
};
const self = new Map();
let total = 0;
for (let i = 0; i < prof.samples.length; i++) {
  const n = byId.get(prof.samples[i]);
  const dt = prof.timeDeltas[i] / 1000;
  total += dt;
  if (!names.includes(n.callFrame.functionName)) continue;
  const up = parent.get(n.id);
  const key = `${label(n)} <- ${up === undefined ? '(root)' : label(up)}`;
  self.set(key, (self.get(key) ?? 0) + dt);
}
console.log(`total ${total.toFixed(1)} ms`);
for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30))
  console.log(
    `${ms.toFixed(1).padStart(9)} ms ${((100 * ms) / total).toFixed(1).padStart(5)}%  ${key}`,
  );
