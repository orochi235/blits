// Self time by function in a V8 .cpuprofile, most first, as ms and share of the whole profile.
//   node bench/profsum.mjs <file.cpuprofile> [top]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const prof = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const top = Number(process.argv[3] ?? 40);
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
let total = 0;
for (let i = 0; i < prof.samples.length; i++) {
  const n = byId.get(prof.samples[i]);
  const f = n.callFrame;
  const where = f.url ? `${basename(f.url)}:${f.lineNumber + 1}` : '';
  const key = `${f.functionName || '(anonymous)'} ${where}`.trim();
  const dt = prof.timeDeltas[i] / 1000;
  self.set(key, (self.get(key) ?? 0) + dt);
  total += dt;
}
console.log(`total ${total.toFixed(1)} ms`);
for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top))
  console.log(
    `${ms.toFixed(1).padStart(9)} ms ${((100 * ms) / total).toFixed(1).padStart(5)}%  ${key}`,
  );
