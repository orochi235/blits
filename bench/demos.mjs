// Times every live demo on the built site: per frame, the whole animation-frame callback and the
// part of it spent inside a mix's sync, probe, pull or project. That part is the most a different
// engine could take off a frame. Serves `site/dist` itself, so build the site first.
//
//   npm --prefix site run build && node bench/demos.mjs --out bench/runs/<date>-demos.json
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { cpus, hostname, loadavg } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const DIST = new URL('../site/dist/', import.meta.url).pathname;
const WARM_MS = 1500;
const MEASURE_MS = 3000;
const PAGES = [
  'start/',
  'channel/',
  'examples/',
  'examples/blend-modes/',
  'examples/hit-flash/',
  'examples/light-board/',
  'examples/number-rules/',
  'examples/retheme/',
  'examples/stack-order/',
  'examples/threshold-wipe/',
  'examples/white-balance/',
  'guides/debugging/',
  'guides/frame-loop/',
  'guides/in-order/',
  'guides/patch-library/',
  'guides/physics/',
  'guides/react/',
  'guides/scrubbing/',
  'guides/three/',
];
const out = process.argv[process.argv.indexOf('--out') + 1];
if (!process.argv.includes('--out') || out === undefined) throw new Error('pass --out <file>');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '::', r));
const base = `http://localhost:${server.address().port}/`;

// Installed before any page script: wraps requestAnimationFrame, and each mix as the registry
// lists it, so time inside a mix is told apart from the rest of the frame.
const hooks = () => {
  const M = { on: false, frames: [], cur: null };
  window.__demo = M;
  const KEY = Symbol.for('@msb235/blits/watch/1');
  const wrapped = new WeakSet();
  let depth = 0;
  const wrap = (mix, name) => {
    for (const fn of ['sync', 'probe', 'pull', 'project']) {
      const orig = mix[fn];
      if (typeof orig !== 'function') continue;
      mix[fn] = function (...args) {
        if (depth > 0 || M.cur === null) return orig.apply(this, args);
        depth++;
        const t = performance.now();
        try {
          return orig.apply(this, args);
        } finally {
          depth--;
          const f = M.cur;
          f.mix += performance.now() - t;
          f[fn]++;
          f.mixes[name] = true;
        }
      };
    }
  };
  const scan = () => {
    const r = globalThis[KEY];
    if (r === undefined) return;
    for (const ref of r.refs.values()) {
      const mix = ref.deref();
      if (mix === undefined || wrapped.has(mix)) continue;
      wrapped.add(mix);
      wrap(mix, r.entries_.get(mix)?.name ?? '?');
    }
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((now) => {
      scan();
      const f = { frame: 0, mix: 0, sync: 0, probe: 0, pull: 0, project: 0, mixes: {} };
      if (M.on) M.cur = f;
      const t = performance.now();
      try {
        cb(now);
      } finally {
        f.frame = performance.now() - t;
        if (M.on) {
          M.cur = null;
          M.frames.push(f);
        }
      }
    });
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(hooks);
const runs = [];
const plan = [];
for (const path of PAGES) {
  await page.goto(base + path);
  const n = await page.locator('figure.live').count();
  for (let i = 0; i < n; i++) plan.push({ path, i });
}
const env = {
  host: hostname(),
  cpus: cpus()[0]?.model,
  load: loadavg(),
  when: new Date().toISOString(),
};
for (const [k, { path, i }] of plan.entries()) {
  await page.goto(base + path);
  await page.locator('figure.live').nth(i).scrollIntoViewIfNeeded();
  await page.evaluate((i) => {
    document.querySelectorAll('figure.live')[i].scrollIntoView({ block: 'center' });
  }, i);
  await page.waitForTimeout(WARM_MS);
  await page.evaluate(() => {
    window.__demo.frames = [];
    window.__demo.on = true;
  });
  await page.waitForTimeout(MEASURE_MS);
  const frames = await page.evaluate(() => {
    window.__demo.on = false;
    return window.__demo.frames;
  });
  const mixes = [...new Set(frames.flatMap((f) => Object.keys(f.mixes)))];
  const sum = (key) => frames.reduce((a, f) => a + f[key], 0);
  const n = Math.max(frames.length, 1);
  const row = {
    path,
    i,
    mixes,
    frames: frames.length,
    frameMs: sum('frame') / n,
    mixMs: sum('mix') / n,
    probes: sum('probe') / n,
    pulls: sum('pull') / n,
    raw: frames.map((f) => [f.frame, f.mix, f.probe, f.pull]),
  };
  runs.push(row);
  console.log(
    `${String(k + 1).padStart(2)}/${plan.length} ${`${path}#${i}`.padEnd(28)} ${(mixes.join(',') || '-').padEnd(28)} frame ${row.frameMs.toFixed(3).padStart(7)} ms  mix ${row.mixMs.toFixed(3).padStart(7)} ms  probes ${String(Math.round(row.probes)).padStart(6)}  pulls ${String(Math.round(row.pulls)).padStart(3)}  frames ${String(row.frames).padStart(3)}`,
  );
}
await writeFile(out, JSON.stringify({ env, warmMs: WARM_MS, measureMs: MEASURE_MS, runs }));
await browser.close();
server.close();
