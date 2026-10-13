// What stopping and starting a subject's voice costs with N running, in the shape weasel's codec
// drives a mix: a tween voice per subject, read by `pull` over a list kept dense by swap-remove.
// Each round stops 100 voices and drops their subjects, cues 100 new ones, then times the two
// frames after and a steady frame beside them.
//   node bench/restart.mjs [N...]          default 1000 10000
//   DIST=/path/to/dist node bench/restart.mjs 10000   another build, to read one against another
import { pathToFileURL } from 'node:url';

const dist = process.env.DIST
  ? pathToFileURL(`${process.env.DIST}/index.js`).href
  : '../dist/index.js';
const { kit, mix, sum, tween, vec } = await import(dist);

const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1000, 10000];
const CHURN = 100;
const WARM = 50;
const ROUNDS = Number(process.env.ROUNDS ?? 300);
const LONG = 1e9;

const run = (n) => {
  const m = mix(kit({ v: vec(2, sum()) }));
  let t = 0;
  m.sync(t);
  let ids = 0;
  let keys = [];
  const handles = [];
  let cols = { v: new Float64Array(0) };
  const waiting = [];
  const start = () => {
    waiting.push(ids++);
  };
  const stop = (i) => {
    handles[i].fade({ over: 0 });
    m.drop(keys[i]);
    const last = keys.length - 1;
    keys[i] = keys[last];
    handles[i] = handles[last];
    keys.pop();
    handles.pop();
  };
  const frame = () => {
    if (waiting.length > 0) {
      keys = keys.slice();
      for (const key of waiting) {
        const patch = tween('v', { from: [key, 0], to: [key, 0], ms: LONG });
        handles.push(m.cue({ patch, subjects: [key] }));
        patch.to(key, [key + 500, 100], 0);
        keys.push(key);
      }
      waiting.length = 0;
      if (cols.v.length !== keys.length * 2) cols = { v: new Float64Array(keys.length * 2) };
    }
    t += 16;
    m.sync(t);
    m.pull(keys, cols);
  };
  for (let i = 0; i < n; i++) start();
  for (let i = 0; i < WARM; i++) frame();
  const t0 = performance.now();
  for (let i = 0; i < ROUNDS; i++) frame();
  const steady = (performance.now() - t0) / ROUNDS;

  let stopping = 0;
  let starting = 0;
  let first = 0;
  let second = 0;
  let turn = 0;
  for (let r = 0; r < WARM + ROUNDS; r++) {
    const a = performance.now();
    for (let i = 0; i < CHURN; i++) stop((turn++ * 7919) % keys.length);
    const b = performance.now();
    for (let i = 0; i < CHURN; i++) start();
    const c = performance.now();
    frame();
    const d = performance.now();
    frame();
    const e = performance.now();
    if (r < WARM) continue;
    stopping += b - a;
    starting += c - b;
    first += d - c;
    second += e - d;
  }
  return {
    stop: (stopping * 1000) / (ROUNDS * CHURN),
    start: (starting * 1000) / (ROUNDS * CHURN),
    first: first / ROUNDS,
    second: second / ROUNDS,
    steady,
  };
};

// Warm on a small mix, so the first size is not also the compile.
run(200);
for (const [i, n] of sizes.entries()) {
  const r = run(n);
  console.log(
    `${String(i + 1).padStart(2)}/${sizes.length}  N=${String(n).padStart(6)}` +
      `  stop ${r.stop.toFixed(2).padStart(6)} us each` +
      `  start ${r.start.toFixed(2).padStart(6)} us each` +
      `  frame after ${r.first.toFixed(3).padStart(7)} ms` +
      `  the one after ${r.second.toFixed(3).padStart(7)} ms` +
      `  steady ${r.steady.toFixed(3).padStart(7)} ms`,
  );
}
