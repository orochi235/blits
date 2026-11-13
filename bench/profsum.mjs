// Self time by function in V8 .cpuprofiles, summed over the files, most first, as ms and share.
//   node bench/profsum.mjs <file.cpuprofile>... [top]
// INCL=1 counts each function's time with its callees'.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith('.cpuprofile'));
const top = Number(args.find((a) => !a.endsWith('.cpuprofile')) ?? 40);
const incl = Boolean(process.env.INCL);
const self = new Map();
let total = 0;
for (const file of files) {
  const prof = JSON.parse(readFileSync(file, 'utf8'));
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n);
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = prof.timeDeltas[i] / 1000;
    total += dt;
    const seen = new Set();
    for (let n = byId.get(prof.samples[i]); n !== undefined; n = parent.get(n.id)) {
      const f = n.callFrame;
      const where = f.url ? `${basename(f.url)}:${f.lineNumber + 1}` : '';
      const key = `${f.functionName || '(anonymous)'} ${where}`.trim();
      if (!seen.has(key)) self.set(key, (self.get(key) ?? 0) + dt);
      seen.add(key);
      if (!incl) break;
    }
  }
}
console.log(`total ${total.toFixed(1)} ms`);
for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top))
  console.log(
    `${ms.toFixed(1).padStart(9)} ms ${((100 * ms) / total).toFixed(1).padStart(5)}%  ${key}`,
  );
