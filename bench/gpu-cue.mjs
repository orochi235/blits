// What `cue` costs for a voice naming n subjects with a stagger, `(c) => (c.i % 256) * 4` as
// gpu-reach's MIX=owned staggers its nudge, cued to start at once on a mix synced to 0. Each repeat
// is a fresh mix, so nothing is cached across them. Rows `mixer` (the stock engine) and `gpu` (the
// gpu engine, whose `delayed` hook hashes the delays into levels and puts their codes in a buffer);
// the difference is what the gpu engine adds. A repeat's parts, on both rows: `cue` (the call),
// then outside any mix, `hash` (`levelsOf` on a fresh copy of the same delays) and `upload` (a
// buffer the size of its codes made mapped, filled and unmapped, as `Timings.stage` does).
//
//   ROWS=mixer:1000000,gpu:1000000 FRAMES=30 WARM=5 \
//     node bench/gpu-cue.mjs --out bench/runs/<date>-gpu-cue     writes <out>.jsonl
//   node bench/gpu-cue.mjs --digest <out>.jsonl     medians, p95, and each part's median
// A record's `frames` are the repeats' cue times, not frames. PROFILE=<repeat>,... profiles those
// repeats' cue calls alone.
import { digest, digested, run } from './gpu-harness.mjs';

const PARTS = ['cue', 'hash', 'upload'];

const recs = digested();
if (recs) {
  digest(recs, PARTS);
  process.exit(0);
}

const ROWS = process.env.ROWS;
if (!ROWS) throw new Error('ROWS is required, as engine:subjects pairs: mixer or gpu');
const rows = ROWS.split(',').map((r) => {
  const [engine, n] = r.split(':');
  if (!['mixer', 'gpu'].includes(engine)) throw new Error(`no engine ${engine}`);
  return { engine, n: Number(n) };
});

const PAGE = `
import { gpu } from './src/gpu/engine.ts';
import { levelsOf } from './src/gpu/levels.ts';
import { keys, kit, mix, mixer, sum } from './src/index.ts';

const stagger = (c) => (c.i % 256) * 4;

window.bench = async (engine, n, frames, warm) => {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const info = adapter.info ?? {};
  const device = await adapter.requestDevice();
  const K = kit({ x: sum() });
  const nudge = keys(1000, [
    { at: 0, delta: { x: 0 } },
    { at: 0.5, delta: { x: 3 }, ease: 'ease-in-out' },
    { at: 1, delta: { x: 0 } },
  ]);
  const cells = Array.from({ length: n }, (_, i) => ({ i }));
  const shape = Float64Array.from(cells, stagger);
  const times = [];
  const parts = [];
  for (let r = 1; r <= warm + frames; r++) {
    const m = mix(K, { name: 'gpu-cue', engine: engine === 'gpu' ? gpu({ device }) : mixer });
    m.sync(0);
    const pf = Array.isArray(window.profiled) && window.profiled.includes(r);
    if (pf) console.profile('frame ' + r);
    const a = performance.now();
    m.cue({ patch: nudge, subjects: cells, stagger, fade: { in: 300 } });
    const b = performance.now();
    if (pf) console.profileEnd('frame ' + r);
    const levels = levelsOf(shape.slice());
    const c = performance.now();
    const codes = levels.codes;
    const buffer = device.createBuffer({ size: codes.byteLength, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
    new Uint16Array(buffer.getMappedRange()).set(codes);
    buffer.unmap();
    const d = performance.now();
    buffer.destroy();
    m.close();
    if (r > warm) {
      times.push(b - a);
      parts.push([b - a, c - b, d - c]);
    }
    // Lets the collector run between repeats, as frames would.
    await new Promise((res) => setTimeout(res, 50));
  }
  device.destroy();
  return {
    frames: times,
    parts,
    adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' '),
    ua: navigator.userAgent,
    isolated: crossOriginIsolated,
  };
};
`;

await run(PAGE, rows, 'stagger');
