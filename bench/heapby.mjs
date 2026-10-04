// What a mix of N voices of one subject each holds, by constructor: self bytes and counts per
// voice, from a heap snapshot taken after the first frame, less one taken before the mix was made.
//   node --expose-gc bench/heapby.mjs [N] [form]   form: tweens springs fns keyses
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeHeapSnapshot } from 'node:v8';
import { keys, kit, max, mix, mul, patch, spring, sum, tween, vec } from '../dist/index.js';

const N = Number(process.argv[2] ?? 5000);
const form = process.argv[3] ?? 'tweens';
const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()) });
const make = {
  tweens: (s) => tween('position', { from: [0, 0, 0], to: [s.seed, 1, 0], ms: 1e4 }),
  springs: (s) => spring('position', { from: [0, 0, 0], to: [s.seed, 1, 0] }),
  fns: (s) => patch(1e4, (ph) => ({ position: [s.seed * ph, ph, 0] }), { writes: ['position'] }),
  keyses: (s) =>
    keys(1e4, [
      { at: 0, delta: { position: [0, 0, 0] } },
      { at: 1, delta: { position: [s.seed, 1, 0] } },
    ]),
};

function byConstructor() {
  globalThis.gc();
  const file = writeHeapSnapshot(
    join(tmpdir(), `blits-heapby-${process.pid}-${Date.now()}.heapsnapshot`),
  );
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  rmSync(file);
  const f = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const width = f.length;
  const iType = f.indexOf('type');
  const iName = f.indexOf('name');
  const iSize = f.indexOf('self_size');
  const nodes = snap.nodes;
  const strings = snap.strings;
  const out = new Map();
  for (let i = 0; i < nodes.length; i += width) {
    const type = types[nodes[i + iType]];
    const name = type === 'object' || type === 'closure' ? strings[nodes[i + iName]] : `(${type})`;
    const key = type === 'closure' ? `closure ${name}` : name;
    const e = out.get(key) ?? { n: 0, bytes: 0 };
    e.n++;
    e.bytes += nodes[i + iSize];
    out.set(key, e);
  }
  return out;
}

await new Promise((r) => setTimeout(r, 0));
const before = byConstructor();
const subjects = Array.from({ length: N }, (_, j) => ({ seed: j * 0.37 }));
const m = mix(K);
for (const s of subjects) m.cue({ patch: make[form](s), subjects: [s] });
const out = {};
m.sync(16);
for (const s of subjects) m.probe(s, out);
await new Promise((r) => setTimeout(r, 0));
const after = byConstructor();
const rows = [];
for (const [key, e] of after) {
  const b = before.get(key) ?? { n: 0, bytes: 0 };
  const bytes = (e.bytes - b.bytes) / N;
  if (bytes >= 8) rows.push([key, bytes, (e.n - b.n) / N]);
}
rows.sort((a, b) => b[1] - a[1]);
let total = 0;
for (const [, bytes] of rows) total += bytes;
console.log(`${form} N=${N}: ${total.toFixed(0)} B per voice in rows of 8 B or more`);
for (const [key, bytes, n] of rows.slice(0, 40))
  console.log(
    `${bytes.toFixed(0).padStart(6)} B  ${n.toFixed(2).padStart(6)}×  ${key.slice(0, 70)}`,
  );
console.log(m.live, subjects.length);
