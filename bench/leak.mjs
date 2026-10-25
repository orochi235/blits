// What replacing voices leaves on the heap: 1,000 subjects, each voice stopped and a new one cued on
// its subject 20,000 times, a frame every 20, then the heap after a collection against before, and
// how many entries the mix's due queue holds.
//   node --expose-gc bench/leak.mjs [dist] [ms] [tween|fn]   defaults: ./dist, 1e9, fn
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = resolve(process.argv[2] ?? new URL('../dist', import.meta.url).pathname);
const { kit, mix, patch, sum, tween, vec } = await import(pathToFileURL(`${dist}/index.js`).href);
const ms = Number(process.argv[3] ?? 1e9);
const form = process.argv[4] ?? 'fn';
const make =
  form === 'tween'
    ? (k) => tween('v', { from: [k, 0], to: [k + 1, 1], ms })
    : (k) => patch(ms, () => ({ v: [k, 0] }), { writes: ['v'] });
const m = mix(kit({ v: vec(2, sum()) }));
const N = 1000;
const handles = Array.from({ length: N }, (_, k) => m.cue({ patch: make(k), subjects: [k] }));
const cols = { v: new Float64Array(N * 2) };
const keys = Array.from({ length: N }, (_, k) => k);
let t = 0;
const frame = () => {
  t += 16;
  m.sync(t);
  m.pull(keys, cols);
};
frame();
globalThis.gc();
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < 20000; i++) {
  const k = (i * 7919) % N;
  handles[k].fade({ over: 0 });
  handles[k] = m.cue({ patch: make(k), subjects: [k] });
  if (i % 20 === 19) frame();
}
frame();
globalThis.gc();
const after = process.memoryUsage().heapUsed;
// An array in builds before the queue kept its times flat.
const entries = m.due.size ?? m.due.length;
console.log(
  `${form} ${ms} ms: due entries ${entries}, heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB over 20,000 replaced voices`,
);
