// What the gpu engine's reach costs against leaving the voices it reaches on the CPU, each row on
// a page of its own in headless Chromium with WebGPU: `mixer` (every channel read with `pull`),
// `gpu`, and `gpucpu` (the gpu engine with `setReads(false)`, so a voice weighted per subject stays
// on the CPU). A frame is the host's whole frame: `sync`, then on the gpu engine every channel the
// side folds and a `pull` of every channel it gives null for, then `onSubmittedWorkDone`; on
// `mixer`, a `pull` of every channel.
//
//   MIX=signal ROWS=gpu:100000,gpucpu:100000 FRAMES=300 WARM=30 \
//     node bench/gpu-reach.mjs --out bench/runs/<date>-gpu-signal     writes <out>.jsonl
//   node bench/gpu-reach.mjs --digest <out>.jsonl     medians, p95, and each part's median
// MIX=signal is gpu-stock's full mix with no spring, the first keys voice weighted per subject by
// `(c) => 0.5 + 0.5 * Math.sin(c.i * 0.37)`. MIX=owned is blinken's shape: a program owner holding four
// scene owners 1250 ms apart, each scene's voices cued on it over every subject before frame 1: a
// faded keys move on x and y, a wave on y looping for the scene's length, and a keys layer on x
// staggered by `(c.i % 256) * 4` that fades in. Rows `mixer` and `gpu` only.
// One line per row as it finishes; one JSON line per row, every frame's time and parts and the
// conditions it ran under, appended to <out>.jsonl as the row finishes.
import { digest, digested, run } from './gpu-harness.mjs';

const PARTS = ['sync', 'fold', 'pull', 'wait'];

const recs = digested();
if (recs) {
  digest(recs, PARTS);
  process.exit(0);
}

const MIX = process.env.MIX ?? 'signal';
const ROWS = process.env.ROWS;
if (!ROWS) throw new Error('ROWS is required, as engine:subjects pairs: mixer, gpu or gpucpu');
const rows = ROWS.split(',').map((r) => {
  const [engine, n] = r.split(':');
  if (!['mixer', 'gpu', 'gpucpu'].includes(engine)) throw new Error(`no engine ${engine}`);
  return { engine, n: Number(n) };
});

const PAGE = `
import { gpu, gpuOf } from './src/gpu/engine.ts';
import { setReads } from './src/gpu/weight.ts';
import { keys, kit, mix, mixer, sum, wave } from './src/index.ts';

const FRAME_MS = 1000 / 60;

async function device() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const info = adapter.info ?? {};
  return { device: await adapter.requestDevice(), adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') };
}

// Each mix: its kit's channels, and the channels gpucpu must leave on the CPU.
const mixes = {
  signal: {
    names: ['x', 'y'],
    cpu: ['x'],
    cue(m, cells) {
      const bounce = keys(2000, [
        { at: 0, delta: { x: 0 } },
        { at: 0.5, delta: { x: 10 }, ease: 'ease-in-out' },
        { at: 1, delta: { x: 0 } },
      ]);
      const rise = keys(1500, [
        { at: 0, delta: { y: 0 } },
        { at: 1, delta: { y: 4 }, ease: 'ease-out' },
      ]);
      const drift = keys(3000, [
        { at: 0, delta: { x: 0, y: 0 } },
        { at: 0.3, delta: { x: 5, y: -5 }, ease: { steps: 4 } },
        { at: 1, delta: { x: 0, y: 0 }, ease: 'ease' },
      ]);
      const sway = wave(1000, { depth: { y: 3 }, shape: 'triangle' });
      m.cue({ patch: bounce, subjects: cells, loop: true, weight: (c) => 0.5 + 0.5 * Math.sin(c.i * 0.37) });
      for (const patch of [rise, drift, sway]) m.cue({ patch, subjects: cells, loop: true });
    },
  },
  owned: {
    names: ['x', 'y'],
    cpu: null,
    cue(m, cells) {
      const SCENE = 1250;
      const move = keys(SCENE, [
        { at: 0, delta: { x: 0, y: 0 } },
        { at: 0.6, delta: { x: 8, y: -4 }, ease: 'ease-in-out' },
        { at: 1, delta: { x: 12, y: 0 }, ease: 'ease-out' },
      ]);
      const bob = wave(250, { depth: { y: 2 }, shape: 'sine' });
      const nudge = keys(1000, [
        { at: 0, delta: { x: 0 } },
        { at: 0.5, delta: { x: 3 }, ease: 'ease-in-out' },
        { at: 1, delta: { x: 0 } },
      ]);
      const program = m.owns({ name: 'program' });
      for (let k = 0; k < 4; k++) {
        const scene = m.owns({ owner: program, start: k * SCENE, name: 'scene' + k });
        m.cue({ patch: move, owner: scene, subjects: cells, fade: { in: 200, out: 200 } });
        m.cue({ patch: bob, owner: scene, subjects: cells, loop: SCENE / 250 });
        m.cue({ patch: nudge, owner: scene, subjects: cells, stagger: (c) => (c.i % 256) * 4, fade: { in: 300 } });
      }
    },
  },
};

window.bench = async (engine, n, frames, warm, variant) => {
  const spec = mixes[variant];
  if (!spec) throw new Error('no mix ' + variant);
  if (engine === 'gpucpu' && spec.cpu === null) throw new Error('mix ' + variant + ' has no gpucpu row');
  const onGpu = engine !== 'mixer';
  setReads(engine !== 'gpucpu');
  const g = onGpu ? await device() : null;
  const K = kit(Object.fromEntries(spec.names.map((name) => [name, sum()])));
  const m = mix(K, { name: 'gpu-reach', engine: g ? gpu({ device: g.device }) : mixer });
  m.sync(0);
  const cells = Array.from({ length: n }, (_, i) => ({ i }));
  spec.cue(m, cells);
  const all = Object.fromEntries(spec.names.map((name) => [name, new Float64Array(n)]));

  let fold = () => all;
  let wait = async () => {};
  if (g) {
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    m.sync(FRAME_MS / 2);
    for (const name of spec.names) side.channel(name);
    await side.ready;
    // The fold dispatched; what it leaves null is pulled on the CPU. On gpu, nothing may be.
    fold = (f) => {
      const rest = {};
      for (const name of spec.names) if (side.channel(name) === null) rest[name] = all[name];
      if (engine === 'gpu' && Object.keys(rest).length > 0)
        throw new Error(Object.keys(rest).join(',') + ' left the GPU at frame ' + f);
      return rest;
    };
    wait = () => g.device.queue.onSubmittedWorkDone();
    m.sync(FRAME_MS * 0.75);
    const left = Object.keys(fold(0)).sort().join(',');
    const want = engine === 'gpucpu' ? [...spec.cpu].sort().join(',') : '';
    if (left !== want) throw new Error(engine + ' leaves [' + left + '] on the CPU, not [' + want + ']');
  }
  const times = [];
  // Per frame: sync, the gpu side's fold (none on mixer), the pull, the wait for the GPU.
  const parts = [];
  for (let f = 1; f <= warm + frames; f++) {
    const a = performance.now();
    m.sync(f * FRAME_MS);
    const b = performance.now();
    const rest = fold(f);
    const c = performance.now();
    if (Object.keys(rest).length > 0) m.pull(cells, rest);
    const d = performance.now();
    await wait();
    const e = performance.now();
    if (f > warm) {
      times.push(e - a);
      parts.push([b - a, c - b, d - c, e - d]);
    }
  }
  m.close();
  g?.device.destroy();
  setReads(true);
  return { frames: times, parts, adapter: g?.adapter ?? null, ua: navigator.userAgent, isolated: crossOriginIsolated };
};
`;

await run(PAGE, rows, MIX);
