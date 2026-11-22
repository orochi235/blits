// What a plotted mix keeps growing frame after frame: old space used after a full GC at checkpoints,
// then, by constructor, what the heap gained between the first checkpoint and the last. The scene is
// `glowb^`'s: 10k subjects plotted, a flicker voice over all of them and one bounded by `within`,
// read by `pull`.
//   node --expose-gc bench/plotleak.mjs [frames] [checkpoints]
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getHeapSpaceStatistics, writeHeapSnapshot } from 'node:v8';
import { kit, max, mix, mul, patch } from '../dist/index.js';

const FRAMES = Number(process.argv[2] ?? 3000);
const CHECKS = Number(process.argv[3] ?? 3);
const N = 10000;

function byConstructor() {
  globalThis.gc();
  const file = writeHeapSnapshot(
    join(tmpdir(), `blits-plotleak-${process.pid}-${Date.now()}.heapsnapshot`),
  );
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  rmSync(file);
  const f = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const width = f.length;
  const [iType, iName, iSize] = ['type', 'name', 'self_size'].map((k) => f.indexOf(k));
  const out = new Map();
  for (let i = 0; i < snap.nodes.length; i += width) {
    const type = types[snap.nodes[i + iType]];
    const name = String(snap.strings[snap.nodes[i + iName]]).slice(0, 50);
    const key = type === 'object' ? name : `(${type}) ${name}`;
    const e = out.get(key) ?? { n: 0, bytes: 0 };
    e.n++;
    e.bytes += snap.nodes[i + iSize];
    out.set(key, e);
  }
  return out;
}

const oldUsed = () => {
  globalThis.gc();
  const s = getHeapSpaceStatistics().find((x) => x.space_name === 'old_space');
  return Math.round(s.space_used_size / 1024);
};

const side = Math.round(Math.sqrt(N));
const subjects = Array.from({ length: N }, (_, j) => ({
  seed: j * 0.37,
  x: j % side,
  y: Math.floor(j / side),
}));
const xy = new Float64Array(2 * N);
for (let j = 0; j < N; j++) {
  xy[2 * j] = subjects[j].x;
  xy[2 * j + 1] = subjects[j].y;
}
const m = mix(kit({ gain: mul(), dark: max() }));
const R = 8;
const pointer = { x: 0, y: 0, r: R };
m.plot(subjects, xy, R);
m.cue({
  patch: patch(
    180,
    (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)), dark: ph * 0.1 }),
    {
      writes: ['gain', 'dark'],
    },
  ),
  loop: true,
});
m.cue({
  patch: patch(1000, () => ({ gain: 1.5 }), { writes: ['gain'] }),
  weight: (s) => Math.max(0, 1 - Math.hypot(s.x - pointer.x, s.y - pointer.y) / R),
  loop: true,
  within: pointer,
});
const columns = { gain: new Float64Array(N), dark: new Float64Array(N) };
let t = 0;
const run = (frames) => {
  for (let f = 0; f < frames; f++) {
    t += 16.7;
    const a = t / 2000;
    pointer.x = side / 2 + (side / 3) * Math.cos(a);
    pointer.y = side / 2 + (side / 3) * Math.sin(a);
    m.sync(t);
    m.pull(subjects, columns);
  }
};

run(100);
await new Promise((r) => setTimeout(r, 0));
const start = byConstructor();
console.log(`frame 100: old space ${oldUsed()} kB`);
for (let c = 1; c <= CHECKS; c++) {
  run(FRAMES / CHECKS);
  await new Promise((r) => setTimeout(r, 0));
  console.log(`frame ${100 + (c * FRAMES) / CHECKS}: old space ${oldUsed()} kB`);
}
const end = byConstructor();
const rows = [];
for (const [key, e] of end) {
  const b = start.get(key) ?? { n: 0, bytes: 0 };
  if (e.bytes - b.bytes >= 10240) rows.push([key, e.bytes - b.bytes, e.n - b.n]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log(`gained between frame 100 and ${100 + FRAMES}, by constructor (10 kB or more):`);
for (const [key, bytes, n] of rows.slice(0, 25))
  console.log(
    `${String(Math.round(bytes / 1024)).padStart(8)} kB  ${String(n).padStart(8)}×  ${key}`,
  );
