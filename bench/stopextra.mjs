// What one more subject-keyed map costs a stop, and so what folding one away could save: the
// bench/restart.mjs shape, with EXTRA maps of the bench's own, each holding a small record per
// subject, set at each start and read then deleted at each stop, as `drop` does with a mix's own.
//   EXTRA=<k> node bench/stopextra.mjs [N...]    default 1000 10000 40000; ROUNDS (default 300)
const { kit, mix, sum, tween, vec } = await import('../dist/index.js');

const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1000, 10000, 40000];
const EXTRA = Number(process.env.EXTRA ?? 0);
const ROUNDS = Number(process.env.ROUNDS ?? 300);
const CHURN = 100;
const WARM = 50;
let sink = 0;

const run = (n) => {
  const m = mix(kit({ v: vec(2, sum()) }));
  const extra = Array.from({ length: EXTRA }, () => new Map());
  let t = 0;
  m.sync(t);
  let ids = 0;
  let keys = [];
  const handles = [];
  let cols = { v: new Float64Array(0) };
  const waiting = [];
  const stop = (i) => {
    const key = keys[i];
    handles[i].fade({ over: 0 });
    m.drop(key);
    for (const x of extra) {
      const rec = x.get(key);
      if (rec !== undefined) sink += rec.a;
      x.delete(key);
    }
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
        const patch = tween('v', { from: [key, 0], to: [key, 0], ms: 1e9 });
        handles.push(m.cue({ patch, subjects: [key] }));
        patch.to(key, [key + 500, 100], 0);
        keys.push(key);
        for (const x of extra) x.set(key, { a: key, b: 0 });
      }
      waiting.length = 0;
      if (cols.v.length !== keys.length * 2) cols = { v: new Float64Array(keys.length * 2) };
    }
    t += 16;
    m.sync(t);
    m.pull(keys, cols);
  };
  for (let i = 0; i < n; i++) waiting.push(ids++);
  for (let i = 0; i < WARM; i++) frame();
  let stopping = 0;
  let turn = 0;
  for (let r = 0; r < WARM + ROUNDS; r++) {
    const a = performance.now();
    for (let i = 0; i < CHURN; i++) stop((turn++ * 7919) % keys.length);
    const b = performance.now();
    for (let i = 0; i < CHURN; i++) waiting.push(ids++);
    frame();
    frame();
    if (r >= WARM) stopping += b - a;
  }
  return (stopping * 1000) / (ROUNDS * CHURN);
};

if (process.env.NOWARM !== '1') run(200);
for (const n of sizes)
  console.log(`extra ${EXTRA}  N=${String(n).padStart(6)}  stop ${run(n).toFixed(3)} us each`);
if (sink === 0.5) console.log(sink);
