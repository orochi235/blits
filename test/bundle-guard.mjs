// Bundles each built entry point: `gpu` must carry the readback staging buffer's label, and the
// main and lean entries must not, so nothing of the gpu engine reaches them. Run after `npm run build`.
import { build } from 'esbuild';

const LABEL = 'blits gpu readback';
const root = new URL('..', import.meta.url).pathname;

async function carries(entry) {
  const out = await build({
    entryPoints: [`${root}dist/${entry}.js`],
    bundle: true,
    format: 'esm',
    write: false,
    logLevel: 'error',
  });
  return out.outputFiles[0].text.includes(LABEL);
}

let failed = false;
for (const [entry, want] of [
  ['gpu', true],
  ['index', false],
  ['lean', false],
]) {
  const has = await carries(entry);
  const ok = has === want;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${entry}: ${has ? 'carries' : 'lacks'} readback`);
}
process.exit(failed ? 1 : 0);
