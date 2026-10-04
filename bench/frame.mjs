// Per-frame cost of a mix at scene sizes. Run with `npm run bench`, which builds dist first.
// Rows print as they finish; `first` is the first frame, where each voice meets each subject;
// `p99` and `worst` are single frames, where a collection landing mid-frame shows; `gc` counts
// collections during the timed frames and the ms they paused for.
import { PerformanceObserver } from 'node:perf_hooks';
import { hex, keys, kit, max, mix, mul, patch, spring, sum, tween, vec } from '../dist/index.js';

const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()), color: hex() });

let gcs = 0;
let paused = 0;
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    gcs++;
    paused += entry.duration;
  }
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

// weasel's tween-to-target shape as a spring: each subject heads somewhere of its own.
const settle = () => spring('position', { from: [0, 0, 0], to: (s) => [s.seed, 1, 0] });

// The same shape as a tween, long enough to stay in flight for the whole run, and as weasel's
// animator wrote it before there was one: a `fn` looking each subject's endpoints up per call.
const LONG = 10000;
const smooth = (u) => u * u * (3 - 2 * u);
const glideTo = () =>
  tween('position', { from: [0, 0, 0], to: (s) => [s.seed, 1, 0], ms: LONG, ease: smooth });
const tweenFn = () =>
  patch(
    LONG,
    (ph, s) => {
      const u = smooth(ph);
      return { position: [s.seed * u, u, 0] };
    },
    { writes: ['position'] },
  );

// A voice per subject doing a tween's job, as keys and as a `fn`, each with its own endpoints.
const keysTo = (s) =>
  keys(LONG, [
    { at: 0, delta: { position: [0, 0, 0] } },
    { at: 1, delta: { position: [s.seed, 1, 0] }, ease: smooth },
  ]);
const fnTo = (s) =>
  patch(
    LONG,
    (ph) => {
      const u = smooth(ph);
      return { position: [s.seed * u, u, 0] };
    },
    { writes: ['position'] },
  );

// weasel's animator-on-blits shape: string ids, each node's endpoints held in a map by id.
const easeOut = (u) => 1 - (1 - u) ** 3;
const ends = new Map();
const weaselTween = () =>
  tween('position', {
    from: (id) => ends.get(id).from,
    to: (id) => ends.get(id).to,
    ms: LONG,
    ease: easeOut,
  });
const weaselFn = () =>
  patch(
    LONG,
    (ph, id) => {
      const { from: a, to: b } = ends.get(id);
      const u = easeOut(ph);
      return { position: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, 0] };
    },
    { writes: ['position'] },
  );

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
  // The same three voices weighted by a signal, and `mix.blend` between them, which is both.
  ['signal', 10000, 3],
  ['blend', 10000, 3],
  // One voice per subject, each targeted at its own: magicsmoke's faults on one shared mix.
  ['own', 100, 1],
  ['own', 1000, 1],
  // The same, each voice naming its subject with `subjects`.
  ['named', 100, 1],
  ['named', 1000, 1],
  ['named', 10000, 1],
  // One spring voice over every subject, and one per subject named with `subjects`.
  ['spring', 1000, 1],
  ['spring', 10000, 1],
  ['springs', 1000, 1],
  ['springs', 10000, 1],
  // One tween voice over every subject, one per subject, and a `fn` doing a tween's job.
  ['tween', 10000, 1],
  ['tweens', 10000, 1],
  ['tweens', 100000, 1],
  ['tweenfn', 10000, 1],
  ['keyses', 10000, 1],
  // A tween voice per subject, with one stopped, its subject dropped, and a new one cued on it
  // every frame.
  ['churn', 10000, 1],
  ['fns', 10000, 1],
  ['weasel', 10000, 1],
  ['weaselfn', 10000, 1],
  // Lanes fill every subject they have met: this one probes all 10k once, then 5% each frame.
  ['sparse', 10000, 1],
  // The same rows with lanes off, for the comparison in one run.
  ['keys-', 10000, 3],
  ['spring-', 10000, 1],
  ['tween-', 10000, 1],
  ['tweenfn-', 10000, 1],
  ['sparse-', 10000, 1],
  // Read through `pull` into one array per channel instead of a probe per subject.
  ['fn^', 10000, 3],
  ['keys^', 1000, 3],
  ['keys^', 10000, 3],
  ['spring^', 10000, 1],
  ['tween^', 10000, 1],
  ['tweenfn^', 10000, 1],
  ['keyses^', 10000, 1],
  ['churn^', 10000, 1],
  // weasel's animator on blits: a tween or spring voice per animation, read by `pull`.
  ['tweens^', 10000, 1],
  ['springs^', 10000, 1],
  ['fns^', 10000, 1],
  ['weasel^', 10000, 1],
  // A projection made and probed every frame, as a continuous scrub would: 500 ms ahead, and
  // 300 ms back on a mix keeping 5 s of history.
  ['ahead', 1000, 3],
  ['back', 1000, 3],
];

// FRAMES=20000 for a profile long enough to sample a fast row.
const frames = Number(process.env.FRAMES ?? 300);
// Row names after the script, `node bench/frame.mjs keys keys^`, run only those rows; `tweens:10000`
// only the one at that size.
const only = process.argv.slice(2);
const chosen =
  only.length > 0
    ? rows.filter(([form, n]) => only.includes(form) || only.includes(`${form}:${n}`))
    : rows;
for (const [i, [form, n, voices]] of chosen.entries()) {
  const off = form.endsWith('-');
  const pulls = form.endsWith('^');
  const kind = off || pulls ? form.slice(0, -1) : form;
  const scrub = kind === 'ahead' || kind === 'back';
  const m = mix(K, {
    ...(kind === 'back' ? { history: { ms: 5000 }, stepMs: 5 } : {}),
    lanes: !off,
  });
  const weasel = kind.startsWith('weasel');
  const subjects = Array.from({ length: n }, (_, j) => (weasel ? `n${j}` : { seed: j * 0.37 }));
  if (weasel)
    for (let j = 0; j < n; j++)
      ends.set(`n${j}`, { from: [j, 300 - j, 0], to: [j + 500, 300 - j, 0] });
  const own =
    kind === 'own' ||
    kind === 'named' ||
    kind === 'springs' ||
    kind === 'tweens' ||
    kind === 'keyses' ||
    kind === 'churn' ||
    kind === 'fns';
  if (kind === 'own')
    for (const mine of subjects) m.cue({ patch: flicker(0), target: (s) => s === mine });
  if (kind === 'named') for (const mine of subjects) m.cue({ patch: flicker(0), subjects: [mine] });
  if (kind === 'springs') for (const mine of subjects) m.cue({ patch: settle(), subjects: [mine] });
  const handles =
    kind === 'tweens' || kind === 'churn'
      ? subjects.map((mine) => m.cue({ patch: glideTo(), subjects: [mine] }))
      : [];
  // Replaces the voice of one subject a frame, walking through them all.
  let turn = 0;
  const churn = () => {
    if (kind !== 'churn') return;
    const k = turn++ % n;
    handles[k].fade({ over: 0 });
    m.drop(subjects[k]);
    handles[k] = m.cue({ patch: glideTo(), subjects: [subjects[k]] });
  };
  if (kind === 'keyses')
    for (const mine of subjects) m.cue({ patch: keysTo(mine), subjects: [mine] });
  if (kind === 'fns') for (const mine of subjects) m.cue({ patch: fnTo(mine), subjects: [mine] });
  // Weighted per subject by a signal holding no state: three voices, or a blend between three.
  const by = (s) => 0.5 + 0.5 * Math.sin(s.seed);
  if (kind === 'blend') m.blend([flicker(0), flicker(1), flicker(2)], by, { fade: { in: 100 } });
  for (let v = 0; !own && kind !== 'blend' && v < voices; v++) {
    const p =
      kind === 'keys'
        ? bounce()
        : kind === 'spring'
          ? settle()
          : kind === 'tween'
            ? glideTo()
            : kind === 'tweenfn'
              ? tweenFn()
              : kind === 'weasel'
                ? weaselTween()
                : kind === 'weaselfn'
                  ? weaselFn()
                  : scrub && v === 0
                    ? drift()
                    : flicker(v);
    m.cue({
      patch: p,
      fade: { in: 100 },
      locus: kind === 'locus' ? 'one' : undefined,
      weight: kind === 'signal' ? by : undefined,
    });
  }
  const probed = kind === 'sparse' ? subjects.filter((_, j) => j % 20 === 0) : subjects;
  const scratch = {};
  const columns = {
    gain: new Float64Array(n),
    dark: new Float64Array(n),
    position: new Float64Array(n * 3),
    color: new Float64Array(n),
  };
  const read = (list) => {
    if (pulls) m.pull(list, columns);
    else for (const s of list) m.probe(s, scratch);
  };
  let t = 0;
  let first = 0;
  for (let f = 0; f < 30; f++) {
    const f0 = performance.now();
    t += 16.7;
    churn();
    m.sync(t);
    read(f === 0 ? subjects : probed);
    if (f === 0) first = performance.now() - f0;
  }
  await new Promise((r) => setTimeout(r, 0));
  const before = gcs;
  const pausedBefore = paused;
  const each = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const f0 = performance.now();
    if (scrub) {
      const p = m.project(kind === 'ahead' ? t + 500 : t - 300 + (f % 20) * 5);
      for (const s of probed) p.probe(s, scratch);
    } else {
      t += 16.7;
      churn();
      m.sync(t);
      read(probed);
    }
    each[f] = performance.now() - f0;
  }
  const ms = each.reduce((a, b) => a + b, 0) / frames;
  each.sort();
  const p99 = each[Math.ceil(frames * 0.99) - 1];
  const worst = each[frames - 1];
  await new Promise((r) => setTimeout(r, 0));
  const ns = (ms * 1e6) / (n * voices);
  console.log(
    `${String(i + 1).padStart(2)}/${chosen.length}  ${form.padEnd(7)} N=${String(n).padStart(6)} V=${voices}` +
      `  ${ms.toFixed(3).padStart(8)} ms/frame  ${ns.toFixed(0).padStart(5)} ns/subject·voice` +
      `  p99 ${p99.toFixed(3).padStart(8)}  worst ${worst.toFixed(3).padStart(8)}` +
      `  first ${first.toFixed(1).padStart(7)} ms` +
      `  gc ${String(gcs - before).padStart(4)} ${(paused - pausedBefore).toFixed(1).padStart(6)} ms`,
  );
}
