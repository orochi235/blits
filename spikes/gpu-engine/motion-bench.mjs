// weasel's tweens and springs: the mix against dense loops, CPU only. See README.md.
//   node motion-bench.mjs            N in {1k, 10k, 100k}
//   node motion-bench.mjs --smoke    N in {1k, 10k}, fewer frames
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { denseSpring, denseTween, makeMotionMix, nodes } from './motion.mjs';
import { ex, f3, load, time } from './timing.mjs';
import { sampleOf } from './workload.mjs';

const smoke = process.argv.includes('--smoke');
const NS = smoke ? [1_000, 10_000] : [1_000, 10_000, 100_000];
const FRAMES = smoke ? 60 : 200;
const CHECK_TIMES = [37, 180, 420, 777, 1234, 5000.5, 12345.6];
const SHAPES = ['one', 'per'];
const SHAPE_NAME = { one: 'one voice', per: 'voice/node' };
const KINDS = [
  { kind: 'tween', variants: ['mixer', 'dense fn', 'dense native'] },
  { kind: 'spring', variants: ['mixer', 'dense native'] },
];

function makeDense(kind, variant, c, n, shape) {
  if (kind === 'spring') return denseSpring(c, n, shape);
  return denseTween(c, n, shape, variant === 'dense fn' ? 'fn' : 'native');
}

/** Max abs error of each dense variant's position (and the spring's velocity) against the mix. */
function check(kind, shape, c, n, dense) {
  const idx = sampleOf(n);
  const { m, ids, velocity } = makeMotionMix(kind, shape, c, idx);
  const out = { pos: [0, 0] };
  const err = {};
  const worst = (name, e) => {
    if (!(e <= (err[name] ?? 0))) err[name] = e; // NaN sticks
  };
  for (const name of Object.keys(dense)) err[name] = 0;
  if (kind === 'spring') err['dense native vel'] = 0;
  for (const t of CHECK_TIMES) {
    m.sync(t);
    const ref = idx.map((_, k) => [...m.probe(ids[k], out).pos]);
    for (const [name, d] of Object.entries(dense)) {
      const p = d.frame(t);
      idx.forEach((i, k) => {
        worst(name, Math.abs(ref[k][0] - p[i]));
        worst(name, Math.abs(ref[k][1] - p[n + i]));
      });
      if (d.vel)
        idx.forEach((i, k) => {
          const v = velocity(k, t);
          worst(`${name} vel`, Math.abs(v[0] - d.vel[i]));
          worst(`${name} vel`, Math.abs(v[1] - d.vel[n + i]));
        });
    }
  }
  return err;
}

const perN = KINDS.reduce((a, k) => a + k.variants.length * SHAPES.length, 0);
const total = NS.length * perN;
const rows = [];
const checks = [];
const mixerMedian = new Map();
let pos = 0;

const startLoad = load();
console.log(`loadavg at start: ${startLoad}   (${os.cpus().length} cores)  node ${process.version}`);

for (const n of NS) {
  const c = nodes(n);
  for (const { kind, variants } of KINDS) {
    for (const shape of SHAPES) {
      const dense = {};
      for (const v of variants) if (v !== 'mixer') dense[v] = makeDense(kind, v, c, n, shape);
      const err = check(kind, shape, c, n, dense);
      checks.push({ n, kind, shape, ...err });
      console.log(
        `         check N=${String(n).padStart(6)} ${kind.padEnd(6)} ${SHAPE_NAME[shape].padEnd(10)}  max abs error vs mixer:` +
          Object.entries(err)
            .map(([k, e]) => `  ${k} ${ex(e)}`)
            .join(''),
      );

      let mixerMs;
      for (const variant of variants) {
        pos++;
        const head =
          `${String(pos).padStart(3)}/${total}  N=${String(n).padStart(6)}  ${kind.padEnd(6)} ` +
          `${SHAPE_NAME[shape].padEnd(10)} ${variant.padEnd(12)}`;
        let step;
        let setupMs = 0;
        if (variant === 'mixer') {
          const key = `${kind} ${shape}`;
          const smaller = mixerMedian.get(`${key} ${n / 10}`);
          if (n >= 100_000 && smaller !== undefined && smaller * 10 > 1000) {
            console.log(`${head}  skipped: a frame would exceed ~1 s (${n / 10} took ${smaller.toFixed(1)} ms)`);
            rows.push({ n, kind, shape, variant, skipped: true });
            continue;
          }
          const t0 = performance.now();
          const all = Array.from({ length: n }, (_, i) => i);
          const { m, ids } = makeMotionMix(kind, shape, c, all);
          setupMs = performance.now() - t0;
          const out = { pos: [0, 0] };
          step = (t) => {
            m.sync(t);
            for (let i = 0; i < ids.length; i++) m.probe(ids[i], out);
          };
        } else {
          const d = makeDense(kind, variant, c, n, shape);
          step = (t) => d.frame(t);
        }
        const r = await time(step, FRAMES);
        if (variant === 'mixer') {
          mixerMs = r.median;
          mixerMedian.set(`${kind} ${shape} ${n}`, r.median);
        }
        const speedup = mixerMs === undefined ? undefined : mixerMs / r.median;
        rows.push({ n, kind, shape, variant, ...r, setupMs, speedup });
        const ns = (r.median * 1e6) / n;
        console.log(
          `${head}  median ${f3(r.median)} ms  p95 ${f3(r.p95)} ms  ${ns.toFixed(1).padStart(7)} ns/node` +
            `  ${speedup === undefined ? '       ' : `${speedup.toFixed(1).padStart(6)}x`}  (${String(r.frames).padStart(3)} frames` +
            `${variant === 'mixer' ? `, setup ${setupMs.toFixed(0)} ms` : ''})`,
        );
      }
    }
  }
}

const endLoad = load();
console.log(`\nloadavg at end: ${endLoad}`);
writeFileSync(
  new URL('./motion-results.json', import.meta.url),
  `${JSON.stringify({ smoke, node: process.version, cores: os.cpus().length, host: os.hostname(), load: { start: startLoad, end: endLoad }, checks, rows }, null, 2)}\n`,
);
