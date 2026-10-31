import { spawn } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['apps/stress/src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'apps/stress/.build/cli.mjs',
  alias: { '@msb235/blits': './src/index.ts', '@stress': './apps/stress/src' },
  external: ['@weasel-js/history'],
  logLevel: 'warning',
});

const child = spawn(
  process.execPath,
  ['--expose-gc', 'apps/stress/.build/cli.mjs', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));
