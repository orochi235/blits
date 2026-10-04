// Prints the lines with the most self time inside the named functions of a V8 CPU profile.
//   d=$(mktemp -d); node --cpu-prof --cpu-prof-dir=$d bench/frame.mjs blend; node bench/lines.mjs $d gatherLocus one; rm -rf $d
// Lines are of the compiled `dist/` file. TOP (default 12) is how many lines to print a function.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, ...names] = process.argv.slice(2);
if (dir === undefined || names.length === 0)
  throw new Error('usage: node bench/lines.mjs <profile dir> <function>...');
const top = Number(process.env.TOP ?? 12);
const file = readdirSync(dir)
  .filter((f) => f.endsWith('.cpuprofile'))
  .sort()
  .at(-1);
if (file === undefined) throw new Error(`no .cpuprofile in ${dir}`);
const profile = JSON.parse(readFileSync(join(dir, file), 'utf8'));
const total = profile.samples.length;
for (const name of names) {
  const lines = new Map();
  let url = '';
  for (const node of profile.nodes) {
    if (node.callFrame.functionName !== name) continue;
    url = node.callFrame.url;
    for (const { line, ticks } of node.positionTicks ?? [])
      lines.set(line, (lines.get(line) ?? 0) + ticks);
  }
  const source = url.startsWith('file://') ? readFileSync(new URL(url), 'utf8').split('\n') : [];
  console.log(`${name}  ${url.split('/').at(-1)}`);
  for (const [line, ticks] of [...lines].sort((a, b) => b[1] - a[1]).slice(0, top))
    console.log(
      `${((100 * ticks) / total).toFixed(1).padStart(5)}%  ${String(line).padStart(5)}  ${(source[line - 1] ?? '').trim().slice(0, 100)}`,
    );
}
