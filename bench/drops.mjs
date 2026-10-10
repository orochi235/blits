// What dropping every subject of a mix costs, with history and without: N subjects under one voice,
// probed, then each dropped in one frame, and with history each then read back from before the drop.
//   node bench/drops.mjs [N...]     default 2000 4000 8000
import { kit, mix, patch, sum } from '../dist/index.js';

const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [2000, 4000, 8000];
const K = kit({ x: sum() });
const run = (n, history) => {
  const m = mix(K, history ? { history: { ms: 5000 } } : {});
  const subjects = Array.from({ length: n }, (_, i) => ({ i }));
  m.cue({ patch: patch(1000, (ph, s) => ({ x: ph + s.i }), { writes: ['x'] }) });
  for (let t = 16; t <= 160; t += 16) {
    m.sync(t);
    for (const s of subjects) m.probe(s);
  }
  const t0 = performance.now();
  for (const s of subjects) m.drop(s);
  const dropped = performance.now() - t0;
  m.sync(176);
  let back = Number.NaN;
  if (history) {
    const t1 = performance.now();
    const p = m.project(160);
    for (const s of subjects) p.probe(s);
    back = performance.now() - t1;
  }
  return { dropped, back };
};
// Warm on a small mix, so the first size is not also the compile.
run(500, true);
run(500, false);
for (const [i, n] of sizes.entries()) {
  const off = run(n, false);
  const on = run(n, true);
  console.log(
    `${String(i + 1).padStart(2)}/${sizes.length}  N=${String(n).padStart(6)}` +
      `  drop ${off.dropped.toFixed(2).padStart(8)} ms` +
      `  with history ${on.dropped.toFixed(2).padStart(8)} ms` +
      `  read back ${on.back.toFixed(2).padStart(8)} ms`,
  );
}
