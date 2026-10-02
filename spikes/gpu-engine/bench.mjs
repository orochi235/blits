// How many subjects x voices each fold strategy fits in a frame. See README.md.
//   node bench.mjs            the full grid
//   node bench.mjs --smoke    two N, two V, fewer frames
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { device, floors, setup } from './gpu.mjs';
import { CHANNELS, dense, flat, makeMix } from './workload.mjs';

const smoke = process.argv.includes('--smoke');
const NS = smoke ? [1_000, 100_000] : [1_000, 10_000, 100_000, 1_000_000];
const VS = smoke ? [1, 8] : [1, 3, 8];
const FRAMES = smoke ? 60 : 200;
const WARM = 30;
const VARIANTS = ['mixer', 'dense', 'gpu', 'gpu+rb', 'gpu+rb2'];
const CHECK_TIMES = [37, 180, 420, 777, 1234, 5000.5, 12345.6];
const BUDGETS = [2, 4, 8];

const load = () =>
  os
    .loadavg()
    .map((x) => x.toFixed(2))
    .join(' ');
const f3 = (x) => x.toFixed(3).padStart(9);
const ex = (x) => x.toExponential(1).padStart(8);
const tick = () => new Promise((r) => setTimeout(r, 0));
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

console.log(`loadavg at start: ${load()}   (${os.cpus().length} cores)`);
const { dev, info } = await device();
console.log(`adapter: ${info}`);
const fl = await floors(dev);
console.log(
  `floor: empty submit -> onSubmittedWorkDone  median ${f3(quantile(fl.empty, 0.5))} ms  p95 ${f3(quantile(fl.empty, 0.95))} ms`,
);
console.log(
  `floor: 4-byte copy  -> mapAsync             median ${f3(quantile(fl.map, 0.5))} ms  p95 ${f3(quantile(fl.map, 0.95))} ms`,
);

/** A spread of subjects to check, and a mix holding only them: a pose depends on i, not on N. */
function sampleOf(n) {
  const idx = new Set([0, 1, 2, n - 1]);
  for (let k = 0; k < 28; k++) idx.add(Math.floor(((k + 0.5) / 28) * n));
  return [...idx];
}

/** Max abs error of each variant against the mix, over the sample, at each check time. */
async function check(n, voices, cpu, g) {
  const idx = sampleOf(n);
  const subjects = idx.map((i) => ({ i }));
  const m = makeMix(voices, subjects);
  const ref = new Float64Array(CHANNELS);
  const out = {};
  const err = { dense: 0, gpu: 0, 'gpu+rb': 0, 'gpu+rb2': 0 };
  const worst = (name, pose, k, i) => {
    flat(m.probe(subjects[k], out), ref);
    for (let c = 0; c < CHANNELS; c++) {
      const e = Math.abs(ref[c] - pose[c * n + i]);
      if (!(e <= err[name])) err[name] = e; // NaN sticks
    }
  };
  let prev = null;
  for (const t of CHECK_TIMES) {
    m.sync(t);
    const p = cpu.frame(t);
    for (let k = 0; k < idx.length; k++) worst('dense', p, k, idx[k]);
    await g.noReadback(t);
    const rb = await g.readback(t); // the same shader into the same pose buffer
    for (let k = 0; k < idx.length; k++) worst('gpu', rb, k, idx[k]);
    for (let k = 0; k < idx.length; k++) worst('gpu+rb', rb, k, idx[k]);
    // Double-buffered hands back the frame before: check it against the mix at that time.
    const late = await g.doubleBuffered(t);
    if (prev !== null) {
      const m2 = makeMix(voices, subjects);
      m2.sync(prev);
      const ref2 = new Float64Array(CHANNELS);
      for (let k = 0; k < idx.length; k++) {
        flat(m2.probe(subjects[k], out), ref2);
        for (let c = 0; c < CHANNELS; c++) {
          const e = Math.abs(ref2[c] - late[c * n + idx[k]]);
          if (!(e <= err['gpu+rb2'])) err['gpu+rb2'] = e;
        }
      }
    }
    prev = t;
  }
  await g.drain();
  return err;
}

async function time(step, frames) {
  let t = 0;
  // A frame after the first, so first-sight setup in the mix is not what decides the warm-up.
  await step((t += 16.7));
  let t0 = performance.now();
  await step((t += 16.7));
  const one = performance.now() - t0;
  const warm = one > 50 ? 3 : WARM;
  const count = one > 20 ? Math.max(10, Math.min(frames, Math.round(4000 / one))) : frames;
  for (let f = 0; f < warm; f++) await step((t += 16.7));
  await tick();
  const ms = [];
  for (let f = 0; f < count; f++) {
    t0 = performance.now();
    await step((t += 16.7));
    ms.push(performance.now() - t0);
  }
  await tick();
  return { median: quantile(ms, 0.5), p95: quantile(ms, 0.95), frames: count };
}

const total = NS.length * VS.length * VARIANTS.length;
const rows = [];
const checks = [];
let pos = 0;
const mixerMedian = new Map();

for (const n of NS) {
  for (const voices of VS) {
    const cpu = dense(n, voices);
    const g = setup(dev, n, voices);
    const err = await check(n, voices, cpu, g);
    checks.push({ n, voices, ...err });
    console.log(
      `       check N=${String(n).padStart(7)} V=${voices}  max abs error vs mixer:` +
        ` dense ${ex(err.dense)}  gpu ${ex(err.gpu)}  gpu+rb ${ex(err['gpu+rb'])}  gpu+rb2 ${ex(err['gpu+rb2'])}`,
    );

    for (const variant of VARIANTS) {
      pos++;
      const head = `${String(pos).padStart(3)}/${total}  N=${String(n).padStart(7)} V=${voices}  ${variant.padEnd(7)}`;
      let step;
      let teardown = async () => {};
      if (variant === 'mixer') {
        // A frame that would exceed ~1 s, judged from the row ten times smaller.
        const smaller = mixerMedian.get(`${n / 10}x${voices}`);
        if (n >= 1_000_000 && (smaller === undefined || smaller * 10 > 1000)) {
          console.log(`${head}  skipped: a frame would exceed ~1 s (${n / 10} took ${smaller?.toFixed(1)} ms)`);
          rows.push({ variant, n, voices, skipped: true });
          continue;
        }
        const subjects = Array.from({ length: n }, (_, i) => ({ i }));
        const m = makeMix(voices, subjects);
        const scratch = {};
        step = (t) => {
          m.sync(t);
          for (const s of subjects) m.probe(s, scratch);
        };
      } else if (variant === 'dense') step = (t) => cpu.frame(t);
      else if (variant === 'gpu') step = (t) => g.noReadback(t);
      else if (variant === 'gpu+rb') step = (t) => g.readback(t);
      else {
        step = (t) => g.doubleBuffered(t);
        teardown = () => g.drain();
      }
      const r = await time(step, FRAMES);
      await teardown();
      if (variant === 'mixer') mixerMedian.set(`${n}x${voices}`, r.median);
      rows.push({ variant, n, voices, ...r });
      const ns = (r.median * 1e6) / (n * voices);
      console.log(
        `${head}  median ${f3(r.median)} ms  p95 ${f3(r.p95)} ms  ${ns.toFixed(2).padStart(8)} ns/subject-voice  (${r.frames} frames)`,
      );
    }
    g.destroy();
  }
}

console.log('\nlargest N x V whose median frame fits the budget:');
console.log(`  ${'variant'.padEnd(8)}${BUDGETS.map((b) => `${String(b).padStart(4)} ms`.padStart(24)).join('')}`);
for (const variant of VARIANTS) {
  const cells = BUDGETS.map((b) => {
    const fit = rows
      .filter((r) => r.variant === variant && !r.skipped && r.median <= b)
      .sort((x, y) => x.n * x.voices - y.n * y.voices)
      .pop();
    return (fit ? `${(fit.n * fit.voices).toLocaleString('en-US')} (${fit.n}x${fit.voices})` : 'none').padStart(24);
  });
  console.log(`  ${variant.padEnd(8)}${cells.join('')}`);
}

console.log(`\nloadavg at end: ${load()}`);
writeFileSync(
  new URL('./results.json', import.meta.url),
  `${JSON.stringify({ smoke, adapter: info, floors: { emptySubmit: quantile(fl.empty, 0.5), map4: quantile(fl.map, 0.5) }, checks, rows }, null, 2)}\n`,
);
dev.destroy();
process.exit(0);
