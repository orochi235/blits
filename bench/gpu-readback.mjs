// What reading a gpu channel back into JS costs, each row on a page of its own in headless Chromium
// with WebGPU: `mixer` (`sync`, then a `pull` of every channel), `gpu` (`sync`, `channel()` of each,
// then `onSubmittedWorkDone`) and `gpuread` (`sync`, then `await Promise.all` of `read()` for each,
// then `onSubmittedWorkDone`), and `gpuinto` (as `gpuread`, each read handed the last one's `values`).
//
//   MIX=readback ROWS=gpuread:100000,gpu:100000 FRAMES=300 WARM=30 \
//     node bench/gpu-readback.mjs --out bench/runs/<date>-gpu-readback     writes <out>.jsonl
//   node bench/gpu-readback.mjs --digest <out>.jsonl     medians, p95, and each part's median
// MIX=readback: a kit of x and y (`sum`) and p and q (`vec(3, sum())`), 8 floats a subject. Four
// looping voices over every subject, cued before frame 1: keys on x and y, a wave on y (a wave writes
// only number channels), keys on p and keys on q. Parts per frame: sync, fold (the `channel` or `read`
// calls up to their return; `pull` on mixer), read (awaiting the reads), wait (`onSubmittedWorkDone`),
// and behind (frames between each read's `timestamp` and this frame's sync; 0 on the other rows).
// One line per row as it finishes; one JSON line per row, every frame's time and parts and the
// conditions it ran under, appended to <out>.jsonl as the row finishes.
import { digest, digested, run } from './gpu-harness.mjs';

const PARTS = ['sync', 'fold', 'read', 'wait', 'behind'];

const recs = digested();
if (recs) {
  digest(recs, PARTS);
  process.exit(0);
}

const MIX = process.env.MIX ?? 'readback';
if (MIX !== 'readback') throw new Error(`no mix ${MIX}`);
const ROWS = process.env.ROWS;
if (!ROWS)
  throw new Error('ROWS is required, as engine:subjects pairs: mixer, gpu, gpuread or gpuinto');
const rows = ROWS.split(',').map((r) => {
  const [engine, n] = r.split(':');
  if (!['mixer', 'gpu', 'gpuread', 'gpuinto'].includes(engine))
    throw new Error(`no engine ${engine}`);
  return { engine, n: Number(n) };
});

const PAGE = `
import { gpu, gpuOf } from './src/gpu/engine.ts';
import { keys, kit, mix, mixer, sum, vec, wave } from './src/index.ts';

const FRAME_MS = 1000 / 60;
const NAMES = ['x', 'y', 'p', 'q'];

async function device() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const info = adapter.info ?? {};
  return { device: await adapter.requestDevice(), adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') };
}

function cue(m, k, cells) {
  const move = keys(1250, [
    { at: 0, delta: { x: 0, y: 0 } },
    { at: 0.6, delta: { x: 8, y: -4 }, ease: 'ease-in-out' },
    { at: 1, delta: { x: 0, y: 0 }, ease: 'ease-out' },
  ], { kit: k });
  const bob = wave(250, { depth: { y: 2 }, shape: 'sine', kit: k });
  const drift = keys(2000, [
    { at: 0, delta: { p: [0, 0, 0] } },
    { at: 0.5, delta: { p: [1, 2, 3] }, ease: 'ease-in' },
    { at: 1, delta: { p: [0, 0, 0] } },
  ], { kit: k });
  const turn = keys(1500, [
    { at: 0, delta: { q: [0, 0, 0] } },
    { at: 0.4, delta: { q: [-2, 1, 0.5] }, ease: 'ease-out' },
    { at: 1, delta: { q: [0, 0, 0] }, ease: 'ease' },
  ], { kit: k });
  for (const patch of [move, bob, drift, turn]) m.cue({ patch, subjects: cells, loop: true });
}

window.bench = async (engine, n, frames, warm, variant) => {
  if (variant !== 'readback') throw new Error('no mix ' + variant);
  const g = engine === 'mixer' ? null : await device();
  const K = kit({ x: sum(), y: sum(), p: vec(3, sum()), q: vec(3, sum()) });
  const m = mix(K, { name: 'gpu-readback', engine: g ? gpu({ device: g.device }) : mixer });
  m.sync(0);
  const cells = Array.from({ length: n }, (_, i) => ({ i }));
  cue(m, K, cells);
  const all = { x: new Float64Array(n), y: new Float64Array(n), p: new Float64Array(3 * n), q: new Float64Array(3 * n) };

  // Per frame: the calls (channel, read or pull), then what they leave to await.
  let fold = () => null;
  let wait = async () => {};
  const into = {};
  if (g) {
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    m.sync(FRAME_MS / 2);
    for (const name of NAMES) {
      side.channel(name);
      if (engine !== 'gpu') void side.read(name);
    }
    await side.ready;
    fold =
      engine === 'gpu'
        ? (f) => {
            for (const name of NAMES)
              if (side.channel(name) === null) throw new Error(name + ' left the GPU at frame ' + f);
            return null;
          }
        : engine === 'gpuread'
          ? () => NAMES.map((name) => side.read(name))
          : () =>
              NAMES.map((name) =>
                side.read(name, into[name]).then((r) => {
                  if (r !== null) into[name] = r.values;
                  return r;
                }),
              );
    wait = () => g.device.queue.onSubmittedWorkDone();
  } else fold = () => (m.pull(cells, all), null);

  const times = [];
  const parts = [];
  const pf = window.profiled;
  for (let f = 1; f <= warm + frames; f++) {
    if (pf === 'timed' ? f === warm + 1 : pf?.includes(f)) console.profile(pf === 'timed' ? 'timed' : 'frame ' + f);
    const a = performance.now();
    m.sync(f * FRAME_MS);
    const b = performance.now();
    const pending = fold(f);
    const c = performance.now();
    let behind = 0;
    if (pending) {
      const reads = await Promise.all(pending);
      for (const [i, r] of reads.entries()) {
        if (r === null) throw new Error(NAMES[i] + ' read null at frame ' + f);
        behind = Math.max(behind, Math.round((m.timestamp - r.timestamp) / FRAME_MS));
      }
    }
    const d = performance.now();
    await wait();
    const e = performance.now();
    if (Array.isArray(pf) && pf.includes(f)) console.profileEnd('frame ' + f);
    performance.measure('frame ' + f, { start: a, end: e });
    if (f > warm) {
      times.push(e - a);
      parts.push([b - a, c - b, d - c, e - d, behind]);
    }
  }
  if (pf === 'timed') console.profileEnd('timed');
  m.close();
  g?.device.destroy();
  return { frames: times, parts, adapter: g?.adapter ?? null, ua: navigator.userAgent, isolated: crossOriginIsolated };
};
`;

await run(PAGE, rows, MIX);
