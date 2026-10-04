// A tween voice per subject read by `pull`, steady, cued four ways: back to back, with unrelated
// objects allocated (and kept) between cues, one a frame, and after every voice has been replaced
// once. EASE=linear swaps the cubic ease-out for a line.
//   node bench/scatter.mjs [packed|junk|staggered|replaced]
import { kit, mix, sum, tween } from '../dist/index.js';

const how = process.argv[2] ?? 'packed';
const N = 10000;
const frames = Number(process.env.FRAMES ?? 3000);
const m = mix(kit({ p: sum() }));
const ease = process.env.EASE === 'linear' ? (u) => u : (u) => 1 - (1 - u) ** 3;
const keep = [];
const cue = (id) => {
  if (how === 'junk') for (let j = 0; j < 40; j++) keep.push({ a: j, b: [j, j], c: `x${j}` });
  return m.cue({ patch: tween('p', { from: 0, to: 1, ms: 1e9, ease }), subjects: [id] });
};
const ids = Array.from({ length: N }, (_, id) => id);
const out = { p: new Float64Array(N) };
let t = 0;
const frame = () => {
  t += 16.7;
  m.sync(t);
  m.pull(ids, out);
};
const handles = [];
for (let id = 0; id < N; id++) {
  handles.push(cue(id));
  if (how === 'staggered') frame();
}
if (how === 'replaced')
  for (let k = 0; k < N; k++) {
    handles[k].fade({ over: 0 });
    if (process.env.JUNK !== '0') for (let j = 0; j < 40; j++) keep.push({ a: j });
    handles[k] = cue(k);
    frame();
  }
for (let f = 0; f < 300; f++) frame();
const a = performance.now();
for (let f = 0; f < frames; f++) frame();
console.log(
  `${how.padEnd(9)} ${(process.env.EASE ?? 'cubic').padEnd(6)} ${((performance.now() - a) / frames).toFixed(3).padStart(7)} ms/frame  kept ${keep.length}`,
);
