// What a subject entering or leaving a playing voice's reach costs: the number a reach that
// changes each frame turns on. The `glow*` rows of bench/frame.mjs with the glow reaching W of the
// N subjects, K of them leaving and K entering each frame. Three ways the engine has of moving a
// subject on or off a voice:
//   part  one glow voice. A subject leaves by `handle.fade({ subject, over: 0 })` and enters by
//         `unpart`, which is NOT public: it is reached here through dist/fade.js, and through the
//         package only by a motion patch's `to` or `push`. A spike, for the internal relink alone.
//   drop  one glow voice whose `target` answers by the window. `mix.drop(subject)` forgets a
//         subject crossing either way, so every voice meets it afresh and `target` is asked again.
//   own   a glow voice for each subject in reach, cued as it enters and faded as it leaves.
//   stale nothing enters or leaves: K subjects in reach have their chains marked stale each
//         frame, as a voice naming them marks them when it comes or goes (`changed` in
//         src/chain.ts, by its `unlink`), so each links again to the records it had. Not public
//         either; it says how much of a row's cost is a relink happening at all.
// `own:0:0` is the voice under the glow alone, which bench/frame.mjs's `glowbase` is too.
// Rows are named `<way>:<K>[:<W>]`; `<way>/<K>` takes its turns apart, K entering on one frame and
// K leaving two frames on with a still frame after each, and prints each of the four frames' median.
// `p50` and `calls` are the median frame and the median time a frame spent in those calls: on a
// node other jobs share, a mean is mostly the frames they interrupted.
// A trailing `-` turns lanes off and `^` reads by `pull`, as in bench/frame.mjs.
//   node bench/reach.mjs part:20 part/200^      FRAMES (default 300) as in bench/frame.mjs.
// Every row ends by checking that the glow weighs exactly the subjects in its window.
import { PerformanceObserver } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { unlink } from '../dist/chain.js';
import { unpart } from '../dist/fade.js';
import { VoiceHandle } from '../dist/handle.js';
import { kit, last, max, mix, mixHex, mul, patch, sum, vec } from '../dist/index.js';

const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()), color: last({ lerp: mixHex }) });
const N = 10000;
const REACH = 200;
// A stride through the subjects, so those entering and leaving are scattered as a glow's rim is.
const STRIDE = 7919;

let gcs = 0;
let paused = 0;
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    gcs++;
    paused += entry.duration;
  }
}).observe({ entryTypes: ['gc'] });

const flicker = () =>
  patch(
    180,
    (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)), dark: ph * 0.1 }),
    { writes: ['gain', 'dark'] },
  );
const glowing = () => patch(1000, () => ({ gain: 1.5 }), { writes: ['gain'] });
// The glow's weight signal for a subject in reach: never 0, so its patch is read.
const lit = (s) => 0.55 + 0.45 * Math.sin(s.seed);

const frames = Number(process.env.FRAMES ?? 300);
const chosen = process.argv.slice(2);
if (chosen.length === 0)
  throw new Error('usage: node bench/reach.mjs <way>:<K>[:<W>][-|^] | <way>/<K>[-|^] ...');
const wide = Math.max(12, ...chosen.map((row) => row.length));
const PHASES = ['enter', 'after', 'leave', 'after'];

for (const [i, row] of chosen.entries()) {
  const off = row.endsWith('-');
  const pulls = row.endsWith('^');
  const spec = /^(part|drop|own|stale)([:/])(\d+)(?::(\d+))?$/.exec(
    off || pulls ? row.slice(0, -1) : row,
  );
  if (spec === null) throw new Error(`bench/reach.mjs: no row ${row}`);
  const way = spec[1];
  const apart = spec[2] === '/';
  if (apart && way === 'stale') throw new Error(`bench/reach.mjs: no row ${row}`);
  const k = Number(spec[3]);
  const reach = Number(spec[4] ?? REACH);

  const m = mix(K, { lanes: !off });
  const side = Math.round(Math.sqrt(N));
  const subjects = Array.from({ length: N }, (_, j) => ({
    seed: j * 0.37,
    x: j % side,
    y: Math.floor(j / side),
    at: 0,
  }));
  const order = subjects.map((_, j) => subjects[(j * STRIDE) % N]);
  for (const [j, s] of order.entries()) s.at = j;
  // The window is `size` subjects of `order` from `lo`, around the ring.
  let lo = 0;
  let size = reach;
  const within = (s) => (s.at - lo + N) % N < size;

  m.cue({ patch: flicker(), loop: true });
  const shape = glowing();
  let glow = null;
  let voice = null;
  const owned = new Map();
  if (way === 'own') {
    for (let j = 0; j < size; j++)
      owned.set(order[j], m.cue({ patch: shape, subjects: [order[j]], weight: lit, loop: true }));
  } else {
    glow = m.cue({
      patch: shape,
      weight: lit,
      loop: true,
      target: way === 'part' ? undefined : within,
    });
    voice = VoiceHandle.voiceOf(glow);
    if (way === 'part') for (let j = size; j < N; j++) glow.fade({ subject: order[j], over: 0 });
  }

  // The window has already moved when these are called for a subject.
  const enter = (s) => {
    if (way === 'part') {
      m.stir();
      unpart(m, voice, s);
    } else if (way === 'drop') m.drop(s);
    else owned.set(s, m.cue({ patch: shape, subjects: [s], weight: lit, loop: true }));
  };
  const leave = (s) => {
    if (way === 'part') glow.fade({ subject: s, over: 0 });
    else if (way === 'drop') m.drop(s);
    else {
      owned.get(s).fade({ over: 0 });
      owned.delete(s);
    }
  };
  const grow = () => {
    const from = lo + size;
    size += k;
    for (let j = 0; j < k; j++) enter(order[(from + j) % N]);
  };
  const shrink = () => {
    const from = lo;
    lo = (lo + k) % N;
    size -= k;
    for (let j = 0; j < k; j++) leave(order[(from + j) % N]);
  };
  const mark = () => {
    for (let j = 0; j < k; j++) {
      const head = m.chains.get(order[(lo + ((turn * k + j) % size)) % N]);
      if (head !== undefined) unlink(m, head);
    }
  };
  let turn = 0;
  const churn = () => {
    const phase = turn++ % 4;
    if (way === 'stale') mark();
    else if (!apart) {
      shrink();
      grow();
    } else if (phase === 0) grow();
    else if (phase === 2) shrink();
    return phase;
  };

  const scratch = {};
  const columns = {
    gain: new Float64Array(N),
    dark: new Float64Array(N),
    position: new Float64Array(N * 3),
    color: new Float64Array(N),
  };
  const read = () => {
    if (pulls) m.pull(subjects, columns);
    else for (const s of subjects) m.probe(s, scratch);
  };

  let t = 0;
  for (let f = 0; f < 32; f++) {
    t += 16.7;
    churn();
    m.sync(t);
    read();
  }
  await new Promise((r) => setTimeout(r, 0));
  const before = gcs;
  const pausedBefore = paused;
  const allocatedBefore = getHeapStatistics().total_allocated_bytes;
  const each = new Float64Array(frames);
  const calling = new Float64Array(frames);
  const byPhase = [[], [], [], []];
  for (let f = 0; f < frames; f++) {
    const f0 = performance.now();
    t += 16.7;
    const phase = churn();
    const f1 = performance.now();
    m.sync(t);
    read();
    const f2 = performance.now();
    each[f] = f2 - f0;
    calling[f] = f1 - f0;
    byPhase[phase].push(f2 - f0);
  }
  const kb = (getHeapStatistics().total_allocated_bytes - allocatedBefore) / frames / 1024;
  const ms = each.reduce((a, b) => a + b, 0) / frames;
  const middle = (xs) => xs.sort((a, b) => a - b)[(xs.length - 1) >> 1] ?? Number.NaN;
  each.sort();
  const p50 = each[(frames - 1) >> 1];
  const p99 = each[Math.ceil(frames * 0.99) - 1];
  await new Promise((r) => setTimeout(r, 0));

  let weighed = 0;
  for (const s of subjects) {
    const w = way === 'own' ? (owned.get(s)?.weightOf(s) ?? 0) : glow.weightOf(s);
    if (w > 0 !== within(s))
      throw new Error(`bench/reach.mjs: ${row} weighs subject ${s.at} ${w}, in reach ${within(s)}`);
    if (w > 0) weighed++;
  }
  if (weighed !== size) throw new Error(`bench/reach.mjs: ${row} weighs ${weighed} of ${size}`);

  const turns = apart
    ? PHASES.map((name, p) => `  ${name} ${middle(byPhase[p]).toFixed(4).padStart(8)}`).join('')
    : '';
  console.log(
    `${String(i + 1).padStart(2)}/${chosen.length}  ${row.padEnd(wide)} N=${String(N).padStart(6)} W=${String(reach).padStart(4)}` +
      `  ${ms.toFixed(4).padStart(8)} ms/frame  p50 ${p50.toFixed(4).padStart(8)}` +
      `  calls ${middle(calling).toFixed(4).padStart(7)}  p99 ${p99.toFixed(3).padStart(8)}` +
      `  gc ${String(gcs - before).padStart(4)} ${(paused - pausedBefore).toFixed(1).padStart(6)} ms` +
      `  ${kb.toFixed(1).padStart(8)} kB/frame${turns}`,
  );
}
