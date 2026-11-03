// The stress demo's heatmap (apps/stress, `heatmap`) headless, with each of its parts swapped out
// in turn, lanes on and off: which of the springs, the per-cell signal weights or `ink` makes its
// `pull` slow. Run with `node bench/heatmap.mjs` after a build. Each setting runs in a process of
// its own, so no setting's numbers depend on the JIT state another left. One line per setting as
// it finishes; every frame's step and read times, with the machine and its load, as JSON lines
// with OUT=<file>. Settings named after the script (`spring/input/ink/on`) run only those.
//   move    spring (the demo), tween (300 ms, retargeted the same), none (no value voice)
//   weight  input (the demo: `input` signals read per cell), fn (the same function, not marked
//           as an input), const (each band at a fixed 1/3)
//   heat    ink (the demo), color (`color()`, OKLab summed), none (no heat voices)
// N cells (default 5000), FRAMES timed frames (default 600) after 60 warm ones.
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { cpus, hostname, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const N = Number(process.env.N ?? 5000);
const FRAMES = Number(process.env.FRAMES ?? 600);
const WARM = 60;
const FRAME_MS = 1000 / 60;

const settings = [];
for (const move of ['spring', 'tween', 'none'])
  for (const heat of ['ink', 'color', 'none'])
    for (const weight of heat === 'none' ? ['-'] : ['input', 'fn', 'const'])
      for (const lanes of ['on', 'off']) settings.push(`${move}/${weight}/${heat}/${lanes}`);

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** Plays one setting and returns its record. */
async function play(name) {
  const blits = await import('../dist/index.js');
  const { color, ink, input, kit, mix, oklab, patch, spring, sum, tween } = blits;
  const [move, weight, heatKind, lanes] = name.split('/');
  const HEAT = heatKind === 'ink' ? 5 : 4;
  const channels = { value: sum() };
  if (heatKind === 'ink') channels.heat = ink();
  if (heatKind === 'color') channels.heat = color();
  const m = mix(kit(channels), { name: 'heatmap', lanes: lanes === 'on' });
  m.sync(0);

  // The demo's own workload: seeded ticks at 20 to 60 Hz a cell, heat decaying each frame.
  let seed = 1;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const cells = Array.from({ length: N }, (_, i) => ({ i }));
  const target = new Float64Array(N);
  const heat = new Float64Array(N);
  const motion =
    move === 'spring'
      ? spring('value', { from: 0, to: (c) => target[c.i] })
      : move === 'tween'
        ? tween('value', { from: 0, to: (c) => target[c.i], ms: 300 })
        : null;
  if (motion !== null) m.cue({ patch: motion, subjects: cells });
  const BANDS = [oklab(0x3a7bd5), oklab(0xf2c14e), oklab(0xe0303a)];
  const touched = [];
  if (heatKind !== 'none')
    BANDS.forEach((band, b) => {
      const read = (c) => Math.max(0, 1 - Math.abs(2 * heat[c.i] - b));
      const w =
        weight === 'input' ? input(read) : weight === 'fn' ? read : weight === 'const' ? 1 / 3 : 0;
      if (weight === 'input') touched.push(w);
      const hold = patch(0, () => ({ heat: band }), { writes: ['heat'] });
      m.cue({ patch: hold, subjects: cells, weight: w });
    });
  const columns = { value: new Float64Array(N) };
  if (heatKind !== 'none') columns.heat = new Float64Array(N * HEAT);

  const steps = [];
  const reads = [];
  for (let f = 0; f < WARM + FRAMES; f++) {
    const a = performance.now();
    const hz = 40 + 20 * Math.sin((2 * Math.PI * f * FRAME_MS) / 10_000);
    const ticks = Math.round((N * hz * FRAME_MS) / 1000);
    for (let t = 0; t < ticks; t++) {
      const i = Math.floor(next() * N);
      const step = (next() - 0.5) * 10;
      target[i] += step;
      heat[i] = Math.min(1, heat[i] + Math.abs(step) / 5);
      motion?.to(cells[i], target[i]);
    }
    for (let i = 0; i < N; i++) heat[i] *= 0.97;
    for (const w of touched) w.touch();
    m.sync(f * FRAME_MS);
    const b = performance.now();
    m.pull(cells, columns);
    const c = performance.now();
    await null;
    if (f >= WARM) {
      steps.push(b - a);
      reads.push(c - b);
    }
  }
  m.close();
  return {
    setting: name,
    move,
    weight,
    heat: heatKind,
    lanes,
    n: N,
    frames: FRAMES,
    host: hostname(),
    cpu: cpus()[0]?.model,
    cpus: cpus().length,
    load: loadavg(),
    node: process.version,
    at: new Date().toISOString(),
    steps,
    reads,
  };
}

const self = fileURLToPath(import.meta.url);
if (process.env.HEATMAP_CHILD) {
  process.stdout.write(JSON.stringify(await play(process.env.HEATMAP_CHILD)));
} else {
  const only = process.argv.slice(2);
  const chosen = only.length > 0 ? settings.filter((s) => only.includes(s)) : settings;
  const out = process.env.OUT;
  if (out) writeFileSync(out, '');
  console.log(`onto: plan ${chosen.length}`);
  for (const [k, name] of chosen.entries()) {
    const raw = execFileSync(process.execPath, [...process.execArgv, self], {
      env: { ...process.env, HEATMAP_CHILD: name },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const rec = JSON.parse(raw);
    if (out) appendFileSync(out, `${JSON.stringify(rec)}\n`);
    const f = (v) => v.toFixed(3).padStart(7);
    console.log(
      `${String(k + 1).padStart(2)}/${chosen.length}  ${name.padEnd(22)}  read p50 ${f(quantile(rec.reads, 0.5))} ms  p90 ${f(quantile(rec.reads, 0.9))}  step p50 ${f(quantile(rec.steps, 0.5))}  load ${rec.load[0].toFixed(2)}`,
    );
    console.log(`onto: progress ${k + 1}/${chosen.length}`);
  }
}
