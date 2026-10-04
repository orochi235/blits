// Splits a frame into sync, the fill (the first probe) and the other reads, for N tween voices of
// one subject each or, with `shared`, one tween voice over N subjects. `node bench/split.mjs 10000 shared`
import { kit, sum, vec } from '../dist/channels.js';
import { mix } from '../dist/mixer.js';
import { tween } from '../dist/motion.js';

const N = Number(process.argv[2] ?? 10000);
const shared = process.argv[3] === 'shared';
const K = kit({ position: vec(3, sum()) });
const subjects = Array.from({ length: N }, (_, i) => ({ i }));
const m = mix(K);
if (shared)
  m.cue({ patch: tween('position', { from: [0, 0, 0], to: (s) => [s.i, 1, 2], ms: 1e9 }) });
else
  for (const s of subjects)
    m.cue({
      patch: tween('position', { from: [0, 0, 0], to: [s.i, 1, 2], ms: 1e9 }),
      subjects: [s],
    });
const out = {};
let t = 0;
const sums = { sync: 0, fill: 0, rest: 0 };
for (let f = 0; f < 400; f++) {
  const a = performance.now();
  t += 16;
  m.sync(t);
  const b = performance.now();
  m.probe(subjects[0], out);
  const c = performance.now();
  for (let i = 1; i < N; i++) m.probe(subjects[i], out);
  const d = performance.now();
  if (f >= 100) {
    sums.sync += b - a;
    sums.fill += c - b;
    sums.rest += d - c;
  }
}
const per = (x) => (x / 300).toFixed(3);
console.log(
  `${shared ? 'shared' : 'per-voice'} N=${N}  sync ${per(sums.sync)}  fill ${per(sums.fill)}  reads ${per(sums.rest)} ms/frame`,
);
