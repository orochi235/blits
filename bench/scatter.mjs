// A tween voice per subject read by `pull`, steady, cued five ways: back to back, with unrelated
// objects allocated (and kept) between cues, one a frame, after every voice has been replaced
// once, and one a frame on a fresh mix after another mix has been through the replacing, which
// tells the JIT's state from the mix's. EASE=linear swaps the cubic ease-out for a line.
//   node bench/scatter.mjs [packed|junk|staggered|replaced|warmed]
import { kit, mix, sum, tween } from '../dist/index.js';

const how = process.argv[2] ?? 'packed';
const N = 10000;
const frames = Number(process.env.FRAMES ?? 3000);
const ease = process.env.EASE === 'linear' ? (u) => u : (u) => 1 - (1 - u) ** 3;
const keep = [];
const ids = Array.from({ length: N }, (_, id) => id);
const out = { p: new Float64Array(N) };

const build = (way) => {
  const m = mix(kit({ p: sum() }));
  const cue = (id) => {
    if (way === 'junk') for (let j = 0; j < 40; j++) keep.push({ a: j, b: [j, j], c: `x${j}` });
    // RETARGET=1 cues each resting at 0 and retargets it at 1 from its start, as weasel's codec does.
    if (process.env.RETARGET !== '1')
      return m.cue({ patch: tween('p', { from: 0, to: 1, ms: 1e9, ease }), subjects: [id] });
    const glide = tween('p', { from: 0, to: 0, ms: 1e9, ease });
    const h = m.cue({ patch: glide, subjects: [id] });
    glide.to(id, 1, 0);
    return h;
  };
  let t = 0;
  const frame = () => {
    t += 16.7;
    m.sync(t);
    m.pull(ids, out);
  };
  const handles = [];
  for (let id = 0; id < N; id++) {
    handles.push(cue(id));
    if (way === 'staggered') frame();
  }
  if (way === 'faded')
    for (let k = 0; k < N; k++) {
      handles[k].fade({ over: 0 });
      frame();
    }
  if (way === 'replaced')
    for (let k = 0; k < N; k++) {
      handles[k].fade({ over: 0 });
      if (process.env.JUNK !== '0') for (let j = 0; j < 40; j++) keep.push({ a: j });
      handles[k] = cue(k);
      frame();
    }
  return frame;
};

// WARM=faded warms on fading every voice one a frame, without cueing any in their place.
if (how === 'warmed') build(process.env.WARM ?? 'replaced');
const frame = build(how === 'warmed' ? 'staggered' : how);
for (let f = 0; f < 300; f++) frame();
const a = performance.now();
for (let f = 0; f < frames; f++) frame();
console.log(
  `${how.padEnd(9)} ${(process.env.EASE ?? 'cubic').padEnd(6)} ${((performance.now() - a) / frames).toFixed(3).padStart(7)} ms/frame  kept ${keep.length}`,
);
