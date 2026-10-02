// Per-frame cost of a mix at scene sizes. Run with `npm run bench`, which builds dist first.
// Rows print as they finish; `first` is the first frame, where each voice meets each subject;
// `gc` counts collections during the timed frames, which is where allocation shows when the
// timing alone does not.
import { PerformanceObserver } from 'node:perf_hooks';
import { hex, keys, kit, max, mix, mul, patch, sum, vec } from '../dist/index.js';

const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()), color: hex() });

let gcs = 0;
new PerformanceObserver((list) => {
  gcs += list.getEntries().length;
}).observe({ entryTypes: ['gc'] });

const flicker = (v) =>
  patch(
    180 + v,
    (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)), dark: ph * 0.1 }),
    { writes: ['gain', 'dark'] },
  );

const bounce = () =>
  keys(1000, [
    { at: 0, delta: { gain: 1, position: [0, 0, 0] } },
    { at: 0.5, delta: { gain: 0.3, position: [5, 2, 0] }, ease: (u) => u * u * (3 - 2 * u) },
    { at: 1, delta: { gain: 1, position: [0, 0, 0] } },
  ]);

// Stateful, so a read back has state to restore from a kept copy and step forward.
const drift = () =>
  patch(0, (_p, _s, st) => ({ dark: st.state.x }), {
    writes: ['dark'],
    state: () => ({ x: 0 }),
    step: (st, dt) => {
      st.x += (1 - st.x) * Math.min(1, dt / 400);
    },
  });

const rows = [
  ['fn', 100, 1],
  ['fn', 1000, 1],
  ['fn', 1000, 3],
  ['fn', 1000, 8],
  ['fn', 10000, 3],
  ['keys', 1000, 1],
  ['keys', 1000, 3],
  ['keys', 10000, 3],
  ['locus', 10000, 3],
  // One voice per subject, each targeted at its own: magicsmoke's faults on one shared mix.
  ['own', 100, 1],
  ['own', 1000, 1],
  // The same, each voice naming its subject with `subjects`.
  ['named', 100, 1],
  ['named', 1000, 1],
  ['named', 10000, 1],
  // A projection made and probed every frame, as a continuous scrub would: 500 ms ahead, and
  // 300 ms back on a mix keeping 5 s of history.
  ['ahead', 1000, 3],
  ['back', 1000, 3],
];

const frames = 300;
for (const [i, [form, n, voices]] of rows.entries()) {
  const scrub = form === 'ahead' || form === 'back';
  const m = mix(K, form === 'back' ? { history: { ms: 5000 }, stepMs: 5 } : {});
  const subjects = Array.from({ length: n }, (_, j) => ({ seed: j * 0.37 }));
  const own = form === 'own' || form === 'named';
  if (form === 'own')
    for (const mine of subjects) m.cue({ patch: flicker(0), target: (s) => s === mine });
  if (form === 'named') for (const mine of subjects) m.cue({ patch: flicker(0), subjects: [mine] });
  for (let v = 0; !own && v < voices; v++) {
    const p = form === 'keys' ? bounce() : scrub && v === 0 ? drift() : flicker(v);
    m.cue({ patch: p, fade: { in: 100 }, locus: form === 'locus' ? 'one' : undefined });
  }
  const scratch = {};
  let t = 0;
  let first = 0;
  for (let f = 0; f < 30; f++) {
    const f0 = performance.now();
    t += 16.7;
    m.sync(t);
    for (const s of subjects) m.probe(s, scratch);
    if (f === 0) first = performance.now() - f0;
  }
  await new Promise((r) => setTimeout(r, 0));
  const before = gcs;
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    if (scrub) {
      const p = m.project(form === 'ahead' ? t + 500 : t - 300 + (f % 20) * 5);
      for (const s of subjects) p.probe(s, scratch);
      continue;
    }
    t += 16.7;
    m.sync(t);
    for (const s of subjects) m.probe(s, scratch);
  }
  const ms = (performance.now() - t0) / frames;
  await new Promise((r) => setTimeout(r, 0));
  const ns = (ms * 1e6) / (n * voices);
  console.log(
    `${String(i + 1).padStart(2)}/${rows.length}  ${form.padEnd(5)} N=${String(n).padStart(6)} V=${voices}` +
      `  ${ms.toFixed(3).padStart(8)} ms/frame  ${ns.toFixed(0).padStart(5)} ns/subject·voice` +
      `  first ${first.toFixed(1).padStart(7)} ms` +
      `  gc ${String(gcs - before).padStart(4)}`,
  );
}
