// Prints the functions with the most self time in a V8 CPU profile, worst first.
//   d=$(mktemp -d); node --cpu-prof --cpu-prof-dir=$d bench/frame.mjs weasel^; node bench/top.mjs $d; rm -rf $d
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (dir === undefined) throw new Error('usage: node bench/top.mjs <profile dir> [rows]');
const rows = Number(process.argv[3] ?? 25);
const file = readdirSync(dir)
  .filter((f) => f.endsWith('.cpuprofile'))
  .sort()
  .at(-1);
if (file === undefined) throw new Error(`no .cpuprofile in ${dir}`);
const profile = JSON.parse(readFileSync(join(dir, file), 'utf8'));
const byId = new Map(profile.nodes.map((n) => [n.id, n.callFrame]));
const self = new Map();
for (const id of profile.samples) {
  const f = byId.get(id);
  const key = `${f.functionName || '(anon)'}  ${f.url.split('/').at(-1)}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + 1);
}
const total = profile.samples.length;
for (const [key, n] of [...self].sort((a, b) => b[1] - a[1]).slice(0, rows))
  console.log(`${((100 * n) / total).toFixed(1).padStart(5)}%  ${key}`);
