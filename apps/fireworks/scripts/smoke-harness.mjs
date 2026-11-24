// Runs a browser smoke test against the fireworks app's dev server, for the panel's and the
// DevTools extension's smoke scripts. The server runs in this process, so nothing outlives it; every
// step has a time limit and the whole run a deadline, and either one fails the run naming the step
// it stopped in. `--shots <dir>` keeps the screenshots, which otherwise go to a temp directory
// removed on exit; a failed run adds one of each watched page.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const app = fileURLToPath(new URL('../', import.meta.url));

const within = (ms, what, promise) => {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took over ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

/**
 * Serves the app on `port` and runs `body({ origin, shots, step, watch, defer })`, then exits the
 * process: 0 if every step passed, 1 otherwise. `step(name, fn, ms)` runs one step under a limit of
 * `ms` (30 s by default); `watch(label, page)` screenshots the page if the run fails; `defer(fn)`
 * runs `fn` on the way out, latest first.
 */
export async function smoke(name, { port, deadlineMs = 180_000 }, body) {
  const at = process.argv.indexOf('--shots');
  const shots = at > 0 ? process.argv[at + 1] : mkdtempSync(join(tmpdir(), `${name}-smoke-`));
  mkdirSync(shots, { recursive: true });
  const started = Date.now();
  let current = 'start the dev server';
  let n = 0;
  const watched = new Map();
  const deferred = [];

  // A hung browser call can ignore every promise above it, so the deadline exits on its own.
  const deadline = setTimeout(() => {
    console.error(`FAIL: ${name} smoke passed its ${deadlineMs / 1000} s deadline in "${current}"`);
    process.exit(1);
  }, deadlineMs);

  const step = async (label, fn, ms = 30_000) => {
    current = label;
    await within(ms, `step "${label}"`, fn());
    const s = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
    console.log(`${String(++n).padStart(2)}  ${s}s  ${label}`);
  };

  let code = 0;
  let server;
  try {
    server = await within(
      60_000,
      'starting the dev server',
      createServer({
        root: app,
        configFile: join(app, 'vite.config.ts'),
        logLevel: 'warn',
        server: { port, strictPort: true },
      }).then((s) => s.listen()),
    );
    await body({
      origin: `http://localhost:${port}/`,
      shots,
      step,
      watch: (label, page) => watched.set(label, page),
      defer: (fn) => deferred.unshift(fn),
    });
    console.log(`ok: ${n} steps; screenshots in ${shots}`);
  } catch (e) {
    code = 1;
    console.error(`FAIL in "${current}": ${e instanceof Error ? e.message : e}`);
    for (const [label, page] of watched)
      await within(
        5000,
        'a failure screenshot',
        page.screenshot({ path: join(shots, `fail-${label}.png`) }),
      ).catch(() => {});
    if (at > 0) console.error(`screenshots in ${shots}`);
  } finally {
    for (const fn of deferred)
      await within(10_000, 'cleanup', Promise.resolve().then(fn)).catch(() => {});
    await within(10_000, 'closing the dev server', server?.close() ?? Promise.resolve()).catch(
      () => {},
    );
    if (at < 0) rmSync(shots, { recursive: true, force: true });
    clearTimeout(deadline);
  }
  process.exit(code);
}
