// The gpu engine's stock patches against the stock mixer: one mix of three `keys` voices, a `wave`
// and a `spring` retargeting 5% of its subjects a frame, folded on `mixer` (every subject read with
// `pull`) and on `gpu` (the fold dispatched, then `onSubmittedWorkDone`), at 10k, 100k and 1M
// subjects. Both run in headless Chromium with WebGPU, as test/gpu/run.mjs does, each row on a page
// of its own. A frame's time is the host's whole frame: the retargets, `sync`, and the read.
//
//   node bench/gpu-stock.mjs --out bench/runs/<date>-gpu-stock      writes <out>.jsonl
//   ROWS=mixer:1000000,gpu:10000 FRAMES=20 node bench/gpu-stock.mjs  only those rows
// MIX=still keeps the spring but retargets nothing; MIX=nospring leaves the spring out. MIX=anchor
// is still played past 2^14 ms of voice time, where the spring's mirror re-anchors (FRAMES=1100).
//   UPLOAD=1 node bench/gpu-stock.mjs --out <out>    the retarget upload alone: a spring mirror's
//   rows at 100k and 1M with 0.1%, 1%, 5% and 25% of them changed at random each frame, written as
//   one writeBuffer per run of changed rows, as one write of the span from the first to the last,
//   as the whole mirror, and as Mirrors.upload chooses between the first two, each taking its turn
//   frame by frame (UPLOADS=1000000:5 for one row)
// One line per row as it finishes; one JSON line per row, every frame's time and the conditions it
// ran under, appended to <out>.jsonl as the row finishes.
//   node bench/gpu-stock.mjs --digest <out>.jsonl     medians and p95 from those records, and each
//   part's median: the retargets, sync, the read (`pull`, or the dispatch), the wait for the GPU
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, hostname, loadavg, totalmem } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const FRAMES = Number(process.env.FRAMES ?? 120);
const WARM = Number(process.env.WARM ?? 20);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const out = arg('--out');

const UPLOAD = process.env.UPLOAD === '1';
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const ms = (x) => x.toFixed(3).padStart(9);

const digest = arg('--digest');
if (digest) {
  const recs = readFileSync(digest, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  if (recs[0]?.kind === 'upload') {
    console.log(
      'subjects   changed   ranges  span MB  ranges ms    span ms   whole ms    rule ms   (medians: issue + GPU wait)',
    );
    for (const r of recs) {
      const med = (k) =>
        ms(
          quantile(
            r[k].map(([a, b]) => a + b),
            0.5,
          ),
        );
      console.log(
        `${String(r.n).padStart(8)} ${`${r.pct}%`.padStart(9)} ${String(Math.round(quantile(r.counts, 0.5))).padStart(8)} ${(quantile(r.spans, 0.5) / 2 ** 20).toFixed(2).padStart(8)} ${med('ranges')}  ${med('span')}  ${med('whole')}  ${med(r.chosen ? 'chosen' : 'gaps')}`,
      );
    }
    process.exit(0);
  }
  console.log(
    'engine          subjects   median ms     p95 ms     max ms  frames   retarget       sync       read       wait',
  );
  for (const r of recs) {
    const part = (k) =>
      ms(
        quantile(
          r.parts.map((p) => p[k]),
          0.5,
        ),
      );
    console.log(
      `${`${r.engine}${r.mix && r.mix !== 'full' ? `/${r.mix}` : ''}`.padEnd(14)} ${String(r.n).padStart(9)} ${ms(quantile(r.frames, 0.5))}  ${ms(quantile(r.frames, 0.95))}  ${ms(Math.max(...r.frames))}  ${String(r.frames.length).padStart(6)}  ${part(0)}  ${part(1)}  ${part(2)}  ${part(3)}`,
    );
  }
  process.exit(0);
}

const all = [];
for (const n of [10_000, 100_000, 1_000_000])
  for (const engine of ['mixer', 'gpu']) all.push({ engine, n });
const only = process.env.ROWS?.split(',');
const MIX = process.env.MIX ?? 'full';
const rows = only ? all.filter((r) => only.includes(`${r.engine}:${r.n}`)) : all;
const uploads = [];
for (const n of [100_000, 1_000_000]) for (const pct of [0.1, 1, 5, 25]) uploads.push({ n, pct });
const onlyUp = process.env.UPLOADS?.split(',');
const upRows = onlyUp ? uploads.filter((r) => onlyUp.includes(`${r.n}:${r.pct}`)) : uploads;

// The page's side: builds the mix for a row and times its frames.
const PAGE = `
import { gpu, gpuOf } from './src/gpu/engine.ts';
import { spanned } from './src/gpu/mirrors.ts';
import { keys, kit, mix, mixer, spring, sum, wave } from './src/index.ts';

const K = kit({ x: sum(), y: sum(), p: sum() });
const FRAME_MS = 1000 / 60;

async function device() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const info = adapter.info ?? {};
  return { device: await adapter.requestDevice(), adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') };
}

window.bench = async (engine, n, frames, warm, variant) => {
  const g = engine === 'gpu' ? await device() : null;
  const m = mix(K, { name: 'gpu-stock', engine: g ? gpu({ device: g.device }) : mixer });
  m.sync(0);
  const cells = Array.from({ length: n }, (_, i) => ({ i }));
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
  const settle = spring('p', { from: 0, to: (c) => c.i % 10, stiffness: 170, damping: 26 });
  for (const patch of [bounce, rise, drift, sway]) m.cue({ patch, subjects: cells, loop: true });
  if (variant !== 'nospring') m.cue({ patch: settle, subjects: cells });

  let read;
  let wait;
  if (g) {
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    side.channel('x');
    await side.ready;
    read = () => {
      for (const name of ['x', 'y', 'p'])
        if (side.channel(name) === null) throw new Error(name + ' is not on the GPU');
    };
    wait = () => g.device.queue.onSubmittedWorkDone();
  } else {
    const columns = { x: new Float64Array(n), y: new Float64Array(n), p: new Float64Array(n) };
    read = () => m.pull(cells, columns);
    wait = async () => {};
  }
  const times = [];
  // Per frame: the retargets, sync, the read (pull, or the GPU side's dispatch), the wait for the GPU.
  const parts = [];
  for (let f = 1; f <= warm + frames; f++) {
    const a = performance.now();
    // 5% of the subjects, a different twentieth each frame.
    if (variant === 'full')
      for (let i = f % 20; i < n; i += 20) settle.to(cells[i], (f % 7) * 3 + (i % 5));
    const b = performance.now();
    m.sync(f * FRAME_MS);
    const c = performance.now();
    read();
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
  return { frames: times, parts, adapter: g?.adapter ?? null, ua: navigator.userAgent, isolated: crossOriginIsolated };
};

// A scalar spring's mirror rows (6 f32s each) on the GPU, pct% of them changed each frame.
window.upload = async (n, pct, frames, warm) => {
  const g = await device();
  const dev = g.device;
  const STRIDE = 6;
  const bytes = STRIDE * 4;
  const rows = new Float32Array(n * STRIDE);
  const buffer = dev.createBuffer({ size: rows.byteLength, usage: 0x0080 | 0x0008 });
  dev.queue.writeBuffer(buffer, 0, rows);
  await dev.queue.onSubmittedWorkDone();
  const k = Math.max(1, Math.round((n * pct) / 100));
  const pick = new Uint8Array(n);
  const ways = {
    ranges: (ranges) => {
      for (const [from, to] of ranges) dev.queue.writeBuffer(buffer, from, rows.subarray(from / 4, to / 4));
    },
    span: (ranges) => {
      const from = ranges[0][0];
      const to = ranges[ranges.length - 1][1];
      dev.queue.writeBuffer(buffer, from, rows.subarray(from / 4, to / 4));
    },
    whole: () => dev.queue.writeBuffer(buffer, 0, rows),
    // What Mirrors.upload does: the span where many runs changed, each run where few did.
    chosen: (ranges) =>
      (spanned(ranges) ? ways.span : ways.ranges)(ranges),
  };
  const out = { ranges: [], span: [], whole: [], chosen: [], counts: [], spans: [] };
  const names = Object.keys(ways);
  for (let f = 0; f < (warm + frames) * names.length; f++) {
    pick.fill(0);
    for (let j = 0; j < k; j++) {
      const r = Math.floor(Math.random() * n);
      pick[r] = 1;
      rows[r * STRIDE] = f + j;
    }
    const ranges = [];
    for (let r = 0; r < n; r++) {
      if (!pick[r]) continue;
      const last = ranges[ranges.length - 1];
      if (last !== undefined && last[1] === r * bytes) last[1] += bytes;
      else ranges.push([r * bytes, (r + 1) * bytes]);
    }
    const name = names[f % names.length];
    const a = performance.now();
    ways[name](ranges);
    dev.queue.submit([]);
    const b = performance.now();
    await dev.queue.onSubmittedWorkDone();
    const c = performance.now();
    if (f >= warm * names.length) {
      out[name].push([b - a, c - b]);
      if (name === 'ranges') {
        out.counts.push(ranges.length);
        out.spans.push(ranges[ranges.length - 1][1] - ranges[0][0]);
      }
    }
  }
  buffer.destroy();
  dev.destroy();
  return { ...out, adapter: g.adapter, ua: navigator.userAgent, isolated: crossOriginIsolated };
};
`;

const root = new URL('..', import.meta.url).pathname;
const js = (
  await build({
    stdin: { contents: PAGE, resolveDir: root, loader: 'ts' },
    bundle: true,
    format: 'esm',
    write: false,
    // Production, as a shipped bundle runs: no development-mode twin checks or warnings.
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  })
).outputFiles[0].text;
// Cross-origin isolated, so performance.now() reads to 5 µs rather than 100.
const server = createServer((req, res) => {
  const headers = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
  };
  if (req.url === '/bench.js')
    return res.writeHead(200, { ...headers, 'content-type': 'text/javascript' }).end(js);
  res
    .writeHead(200, { ...headers, 'content-type': 'text/html' })
    .end('<!doctype html><script type="module" src="/bench.js"></script>');
});
await new Promise((r) => server.listen(0, 'localhost', r));
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu'],
});
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' })
    .trim()
    .concat(
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
        ? '+dirty'
        : '',
    );
} catch {}

const conditions = () => ({
  host: hostname(),
  cpu: cpus()[0]?.model,
  cpus: cpus().length,
  memGB: Math.round(totalmem() / 2 ** 30),
  load: loadavg(),
  node: process.version,
  browser: browser.version(),
  commit,
  at: new Date().toISOString(),
});

if (out) writeFileSync(`${out}.jsonl`, '');
if (UPLOAD) {
  console.log(`onto: plan ${upRows.length}`);
  for (const [k, { n, pct }] of upRows.entries()) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => typeof window.upload === 'function');
    const started = Date.now();
    const got = await page.evaluate(
      ([n, p, f, w]) => window.upload(n, p, f, w),
      [n, pct, FRAMES, WARM],
    );
    await page.close();
    const rec = {
      kind: 'upload',
      n,
      pct,
      warm: WARM,
      ...got,
      wallMs: Date.now() - started,
      ...conditions(),
    };
    if (out) appendFileSync(`${out}.jsonl`, `${JSON.stringify(rec)}\n`);
    const med = (w) =>
      ms(
        quantile(
          got[w].map(([a, b]) => a + b),
          0.5,
        ),
      );
    console.log(
      `${String(k + 1).padStart(2)}/${upRows.length} ${String(n).padStart(8)} ${`${pct}%`.padStart(5)}  ranges ${String(Math.round(quantile(got.counts, 0.5))).padStart(7)}  per-range ${med('ranges')} ms  span ${med('span')} ms  whole ${med('whole')} ms  chosen ${med('chosen')} ms  wall ${(rec.wallMs / 1000).toFixed(1).padStart(6)} s`,
    );
  }
  await browser.close();
  server.close();
  process.exit(0);
}
console.log(`onto: plan ${rows.length}`);
for (const [k, { engine, n }] of rows.entries()) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => typeof window.bench === 'function');
  const started = Date.now();
  const got = await page.evaluate(
    ([e, n, f, w, v]) => window.bench(e, n, f, w, v),
    [engine, n, FRAMES, WARM, MIX],
  );
  await page.close();
  const rec = {
    engine,
    n,
    mix: MIX,
    warm: WARM,
    frames: got.frames,
    parts: got.parts,
    wallMs: Date.now() - started,
    host: hostname(),
    cpu: cpus()[0]?.model,
    cpus: cpus().length,
    memGB: Math.round(totalmem() / 2 ** 30),
    load: loadavg(),
    node: process.version,
    browser: browser.version(),
    ua: got.ua,
    adapter: got.adapter,
    isolated: got.isolated,
    commit,
    at: new Date().toISOString(),
  };
  if (out) appendFileSync(`${out}.jsonl`, `${JSON.stringify(rec)}\n`);
  const top = Math.max(...got.frames);
  console.log(
    `${String(k + 1).padStart(2)}/${rows.length} ${engine.padEnd(5)} ${MIX.padEnd(8)} ${String(n).padStart(8)}  median ${ms(quantile(got.frames, 0.5))} ms  p95 ${ms(quantile(got.frames, 0.95))} ms  max ${ms(top)} ms at frame ${String(got.frames.indexOf(top) + WARM + 1).padStart(5)}  frames ${got.frames.length}  wall ${(rec.wallMs / 1000).toFixed(1).padStart(6)} s`,
  );
}
await browser.close();
server.close();
