// Runs test/gpu/*.gpu.ts in headless Chromium with WebGPU, one line per test as it finishes.
// `channel: 'chromium'` is the full browser in new headless mode, which reaches the real GPU;
// Playwright's default headless shell only gets SwiftShader.
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const dir = new URL('.', import.meta.url).pathname;
const only = process.argv[2];
const files = (await readdir(dir)).filter(
  (f) => f.endsWith('.gpu.ts') && (!only || f.includes(only)),
);
const entry =
  files.map((f) => `import './${f}';`).join('\n') +
  "\nimport { runAll } from './harness.js';\nrunAll();\n";
const out = await build({
  stdin: { contents: entry, resolveDir: dir, loader: 'ts' },
  bundle: true,
  format: 'esm',
  write: false,
  alias: { '@msb235/blits': new URL('../../src/index.ts', import.meta.url).pathname },
  // The package says it has no side effects, which would drop every test file's registrations.
  ignoreAnnotations: true,
  logLevel: 'error',
});
const js = out.outputFiles[0].text;
const server = createServer((req, res) => {
  if (req.url === '/run.js')
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
  res
    .writeHead(200, { 'content-type': 'text/html' })
    .end('<!doctype html><script type="module" src="/run.js"></script>');
});
await new Promise((r) => server.listen(0, 'localhost', r));
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu'],
});
const page = await browser.newPage();
let failed = 0;
let finished;
const done = new Promise((r) => {
  finished = r;
});
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('__gpu__ ')) {
    const e = JSON.parse(t.slice(8));
    if (e.kind === 'adapter') console.log(`adapter ${e.info}`);
    if (e.kind === 'result') {
      if (!e.ok) failed++;
      console.log(
        `${String(e.i).padStart(3)}/${e.n} ${e.ok ? '✓' : '✗'} ${e.name}${e.ok ? '' : `\n      ${e.error}`}`,
      );
    }
    if (e.kind === 'done') finished();
  } else if (m.type() === 'error' || m.type() === 'warning')
    console.log(`  [page ${m.type()}] ${t}`);
});
page.on('pageerror', (e) => {
  console.log(`page error: ${e.message}`);
  failed++;
  finished();
});
await page.goto(`http://localhost:${server.address().port}/`);
await done;
await browser.close();
server.close();
console.log(failed === 0 ? 'all passed' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
