// Call tree of every V8 .cpuprofile in a directory, ms a profile (inclusive), each path at least
// <min> ms and at most <depth> calls deep.
//   node bench/proftree.mjs <dir> [min ms, 1] [depth, 8]
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [dir, min = '1.0', depthMax = '8'] = process.argv.slice(2);
const tree = new Map();
const files = readdirSync(dir).filter((f) => f.endsWith('.cpuprofile'));
for (const f of files) {
  const p = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n);
  const lab = (n) =>
    `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url ? `${basename(n.callFrame.url)}:${n.callFrame.lineNumber + 1}` : ''}`;
  for (let i = 0; i < p.samples.length; i++) {
    const dt = p.timeDeltas[i] / 1000 / files.length;
    const chain = [];
    for (let n = byId.get(p.samples[i]); n; n = parent.get(n.id)) chain.unshift(lab(n));
    for (let d = 1; d <= chain.length; d++) {
      const k = chain.slice(0, d).join(' > ');
      tree.set(k, (tree.get(k) ?? 0) + dt);
    }
  }
}
const keys = [...tree.keys()].filter(
  (k) => tree.get(k) >= Number(min) && k.split(' > ').length <= Number(depthMax),
);
keys.sort();
for (const k of keys) {
  const parts = k.split(' > ');
  console.log(
    `${tree.get(k).toFixed(2).padStart(7)}  ${'  '.repeat(parts.length - 1)}${parts.at(-1)}`,
  );
}
