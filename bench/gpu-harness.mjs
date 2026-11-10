// What the gpu benches share besides their mixes: the page build, its server, headless Chromium
// with WebGPU, the run's conditions, the per-row loop with its progress line and `.jsonl` append,
// and `--digest`. A caller hands over the page source, which defines `window.bench(engine, n,
// frames, warm, mix)` returning `{ frames, parts, adapter, ua, isolated }`, and its rows.
// PROFILE=<frame>,... (or `timed`) has the page CPU-profile those frames through `window.profiled`,
// written to <out>-<engine>-<n>-<title>.cpuprofile; TRACE=1 records a Chromium trace of each row
// to <out>-<engine>-<n>.trace.json, frames marked as `performance.measure`s named `frame <f>`.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, hostname, loadavg, totalmem } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright';

export const FRAMES = Number(process.env.FRAMES ?? 120);
export const WARM = Number(process.env.WARM ?? 20);
export const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
export const out = arg('--out');
const PROFILE = process.env.PROFILE
  ? process.env.PROFILE === 'timed'
    ? 'timed'
    : process.env.PROFILE.split(',').map(Number)
  : null;
const TRACE = process.env.TRACE === '1';
const CATEGORIES = [
  'blink.user_timing',
  'v8',
  'v8.gc',
  'disabled-by-default-v8.gc',
  'gpu',
  'toplevel',
  'devtools.timeline',
];
export const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
export const ms = (x) => x.toFixed(3).padStart(9);

/** The records `--digest` names, or undefined where it names none. */
export function digested() {
  const path = arg('--digest');
  if (!path) return undefined;
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
}

/** Prints each frame record's medians and p95, and each of its `parts`' median. */
export function digest(recs, parts) {
  console.log(
    `engine          subjects   median ms     p95 ms     max ms  frames${parts.map((p) => p.padStart(11)).join('')}`,
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
      `${`${r.engine}${r.mix && r.mix !== 'full' ? `/${r.mix}` : ''}`.padEnd(14)} ${String(r.n).padStart(9)} ${ms(quantile(r.frames, 0.5))}  ${ms(quantile(r.frames, 0.95))}  ${ms(Math.max(...r.frames))}  ${String(r.frames.length).padStart(6)}${parts.map((_, k) => `  ${part(k)}`).join('')}`,
    );
  }
}

const root = new URL('..', import.meta.url).pathname;

/** Builds `source` into a page, serves it cross-origin isolated, and opens headless Chromium. */
export async function launch(source) {
  const js = (
    await build({
      stdin: { contents: source, resolveDir: root, loader: 'ts' },
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
  return {
    browser,
    commit,
    /** A fresh page with the bench loaded, once `global` is defined on it. */
    async open(global) {
      const page = await browser.newPage();
      page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
      await page.goto(`http://localhost:${server.address().port}/`);
      await page.waitForFunction((g) => typeof window[g] === 'function', global);
      return page;
    },
    conditions: () => ({
      host: hostname(),
      cpu: cpus()[0]?.model,
      cpus: cpus().length,
      memGB: Math.round(totalmem() / 2 ** 30),
      load: loadavg(),
      node: process.version,
      browser: browser.version(),
      commit,
      at: new Date().toISOString(),
    }),
    async close() {
      await browser.close();
      server.close();
    },
  };
}

/**
 * Runs each `{ engine, n }` row of `mix` on a page of its own, printing a line and appending its
 * record to `<out>.jsonl` as it finishes.
 */
export async function run(source, rows, mix) {
  const b = await launch(source);
  if (out) writeFileSync(`${out}.jsonl`, '');
  const width = Math.max(5, ...rows.map((r) => r.engine.length));
  console.log(`onto: plan ${rows.length}`);
  for (const [k, { engine, n }] of rows.entries()) {
    const page = await b.open('bench');
    const tag = `${out}-${engine}-${n}`;
    const profiles = [];
    if (PROFILE && out) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      cdp.on('Profiler.consoleProfileFinished', (e) => profiles.push(e));
      await page.evaluate((p) => {
        window.profiled = p;
      }, PROFILE);
    }
    if (TRACE && out) await b.browser.startTracing(page, { categories: CATEGORIES });
    const started = Date.now();
    const got = await page.evaluate(
      ([e, n, f, w, v]) => window.bench(e, n, f, w, v),
      [engine, n, FRAMES, WARM, mix],
    );
    if (TRACE && out) writeFileSync(`${tag}.trace.json`, await b.browser.stopTracing());
    for (const p of profiles)
      writeFileSync(`${tag}-${p.title.replace(/\W+/g, '-')}.cpuprofile`, JSON.stringify(p.profile));
    await page.close();
    const c = b.conditions();
    const rec = {
      engine,
      n,
      mix,
      warm: WARM,
      frames: got.frames,
      parts: got.parts,
      wallMs: Date.now() - started,
      host: c.host,
      cpu: c.cpu,
      cpus: c.cpus,
      memGB: c.memGB,
      load: c.load,
      node: c.node,
      browser: c.browser,
      ua: got.ua,
      adapter: got.adapter,
      isolated: got.isolated,
      commit: c.commit,
      at: c.at,
    };
    if (out) appendFileSync(`${out}.jsonl`, `${JSON.stringify(rec)}\n`);
    const top = Math.max(...got.frames);
    console.log(
      `${String(k + 1).padStart(2)}/${rows.length} ${engine.padEnd(width)} ${mix.padEnd(8)} ${String(n).padStart(8)}  median ${ms(quantile(got.frames, 0.5))} ms  p95 ${ms(quantile(got.frames, 0.95))} ms  max ${ms(top)} ms at frame ${String(got.frames.indexOf(top) + WARM + 1).padStart(5)}  frames ${got.frames.length}  wall ${(rec.wallMs / 1000).toFixed(1).padStart(6)} s`,
    );
  }
  await b.close();
}
