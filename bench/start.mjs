// What starting many voices at once costs: cueing N voices of one subject each, the first frame
// that meets them (sync and a read of every subject), and the second, in a fresh mix each round.
//   node bench/start.mjs [N] [rounds] [forms...]   forms: tweens springs fns keyses named
// PROF=<dir> CPU-profiles the first frame alone, one .cpuprofile per form and round. ALLOC=1
// samples what the first frame allocates, garbage included, and prints it by function.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { keys, kit, max, mix, mul, patch, spring, sum, tween, vec } from '../dist/index.js';

const N = Number(process.argv[2] ?? 10000);
const rounds = Number(process.argv[3] ?? 7);
const all = ['tweens', 'springs', 'fns', 'keyses', 'named'];
const forms = process.argv.length > 4 ? process.argv.slice(4) : all;
const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()) });
const smooth = (u) => u * u * (3 - 2 * u);

const make = {
  tweens: (s) => tween('position', { from: [0, 0, 0], to: [s.seed, 1, 0], ms: 1e4, ease: smooth }),
  springs: (s) => spring('position', { from: [0, 0, 0], to: [s.seed, 1, 0] }),
  fns: (s) =>
    patch(
      1e4,
      (ph) => {
        const u = smooth(ph);
        return { position: [s.seed * u, u, 0] };
      },
      { writes: ['position'] },
    ),
  keyses: (s) =>
    keys(1e4, [
      { at: 0, delta: { position: [0, 0, 0] } },
      { at: 1, delta: { position: [s.seed, 1, 0] }, ease: smooth },
    ]),
  named: () =>
    patch(
      180,
      (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)), dark: ph * 0.1 }),
      {
        writes: ['gain', 'dark'],
      },
    ),
};

const profDir = process.env.PROF;
const alloc = Boolean(process.env.ALLOC);
const session = profDir === undefined && !alloc ? null : new Session();
session?.connect();
if (profDir !== undefined) {
  mkdirSync(profDir, { recursive: true });
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 50 });
}
if (alloc) await session.post('HeapProfiler.enable');
const allocated = new Map();
// A builtin's allocation is told by its caller too.
const tally = (node, caller = '') => {
  const f = node.callFrame;
  const where = f.url === '' ? ` < ${caller}` : `  ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  const at = `${f.functionName || '(anon)'}${where}`;
  if (node.selfSize > 0) allocated.set(at, (allocated.get(at) ?? 0) + node.selfSize);
  for (const c of node.children) tally(c, f.url === '' ? caller : at);
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (x) => x.toFixed(1).padStart(7);
for (const [i, form] of forms.entries()) {
  const cue = [];
  const first = [];
  const second = [];
  for (let r = 0; r < rounds; r++) {
    const m = mix(K);
    const subjects = Array.from({ length: N }, (_, j) => ({ seed: j * 0.37 }));
    const out = {};
    const t0 = performance.now();
    for (const s of subjects) m.cue({ patch: make[form](s), subjects: [s], loop: true });
    if (profDir !== undefined) await session.post('Profiler.start');
    if (alloc)
      await session.post('HeapProfiler.startSampling', {
        samplingInterval: 512,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
    const t1 = performance.now();
    m.sync(16);
    for (const s of subjects) m.probe(s, out);
    const t2 = performance.now();
    if (profDir !== undefined) {
      const { profile } = await session.post('Profiler.stop');
      writeFileSync(`${profDir}/${form}-${r}.cpuprofile`, JSON.stringify(profile));
    }
    if (alloc) tally((await session.post('HeapProfiler.stopSampling')).profile.head);
    m.sync(32);
    for (const s of subjects) m.probe(s, out);
    const t3 = performance.now();
    cue.push(t1 - t0);
    first.push(t2 - t1);
    second.push(t3 - t2);
    await new Promise((res) => setTimeout(res, 0));
  }
  console.log(
    `${i + 1}/${forms.length}  ${form.padEnd(8)} N=${N}  cue ${ms(median(cue))} ms  first frame ${ms(median(first))} ms  second ${ms(median(second))} ms  (medians of ${rounds})`,
  );
  if (!alloc) continue;
  const total = [...allocated.values()].reduce((a, b) => a + b, 0);
  console.log(`  first frame allocates ${(total / rounds / 1024).toFixed(0)} kB a round`);
  for (const [at, bytes] of [...allocated].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`  ${(bytes / rounds / 1024).toFixed(0).padStart(7)} kB  ${at}`);
  allocated.clear();
}
