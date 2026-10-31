import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const DIR = 'apps/stress/.build';
const STALE_MS = 60 * 60_000;
const TEMP = /^cli\.\d+\.tmp\.mjs$/;

mkdirSync(DIR, { recursive: true });
for (const f of readdirSync(DIR)) {
  if (!TEMP.test(f)) continue;
  const p = join(DIR, f);
  try {
    if (Date.now() - statSync(p).mtimeMs > STALE_MS) rmSync(p, { force: true });
  } catch {}
}

// Each launch bundles to its own file and renames it into place, so a parallel launch never runs
// a bundle another is still writing.
const temp = join(DIR, `cli.${process.pid}.tmp.mjs`);
const bundle = join(DIR, 'cli.mjs');
await build({
  entryPoints: ['apps/stress/src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: temp,
  alias: { '@msb235/blits': './src/index.ts', '@stress': './apps/stress/src' },
  external: ['@weasel-js/history'],
  logLevel: 'warning',
});
renameSync(temp, bundle);

const child = spawn(process.execPath, ['--expose-gc', bundle, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
