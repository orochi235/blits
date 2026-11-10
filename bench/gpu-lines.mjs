// Self time by line of a gpu bench page's CPU profile (PROFILE=), most first, with the source file
// each bundle line came from: the lines are the bundle's, which the harness writes beside it.
//   node bench/gpu-lines.mjs <file.cpuprofile> <out>.bundle.js [top]
import { readFileSync } from 'node:fs';

const [prof, bundle, top = 30] = process.argv.slice(2);
const p = JSON.parse(readFileSync(prof, 'utf8'));
const lines = readFileSync(bundle, 'utf8').split('\n');
const fileAt = (l) => {
  for (let i = l - 1; i >= 0; i--) if (lines[i].startsWith('// src/')) return lines[i].slice(3);
  return '?';
};
const interval = (p.endTime - p.startTime) / p.samples.length / 1000;
const by = new Map();
for (const n of p.nodes)
  for (const t of n.positionTicks ?? []) by.set(t.line, (by.get(t.line) ?? 0) + t.ticks);
for (const [l, ticks] of [...by].sort((a, b) => b[1] - a[1]).slice(0, Number(top)))
  console.log(
    `${(ticks * interval).toFixed(1).padStart(7)} ms  ${String(l).padStart(6)} ${fileAt(l).padEnd(28)} ${lines[l - 1].trim().slice(0, 110)}`,
  );
