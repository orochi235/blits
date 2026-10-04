// Whether a mix nobody holds is freed: heap after building, running and dropping mixes of N
// single-subject tween voices. `node --expose-gc bench/leak.mjs 100000`
import { kit, mix, sum, tween, vec } from '../dist/index.js';

const N = Number(process.argv[2] ?? 100000);
const K = kit({ position: vec(3, sum()) });
// A WeakRef keeps its target until the job that made or read it ends, so collect after a turn.
const mb = async () => {
  await new Promise((r) => setTimeout(r, 0));
  globalThis.gc();
  globalThis.gc();
  return (process.memoryUsage().heapUsed / 1e6).toFixed(1).padStart(7);
};
console.log(`start ${await mb()} MB`);
for (let round = 1; round <= 3; round++) {
  await (async () => {
    const m = mix(K);
    const subjects = Array.from({ length: N }, (_, j) => ({ seed: j }));
    for (const s of subjects)
      m.cue({
        patch: tween('position', { from: [0, 0, 0], to: [s.seed, 1, 0], ms: 1e4 }),
        subjects: [s],
      });
    const out = {};
    for (let f = 1; f <= 30; f++) {
      m.sync(f * 16.7);
      for (const s of subjects) m.probe(s, out);
    }
    console.log(`round ${round} live    ${await mb()} MB`);
  })();
  console.log(`round ${round} dropped ${await mb()} MB`);
}
