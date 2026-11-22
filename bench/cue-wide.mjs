// What `cue` costs on the stock mixer for one voice naming N subjects with a stagger, in node: the
// mixer row of bench/gpu-cue.mjs (same kit, patch, stagger and fade, a fresh mix each repeat), for
// any fleet node and for `LINEAGE_BENCH=cue-wide.mjs bench/lineage.sh`.
//   node bench/cue-wide.mjs [N] [repeats] [warm]     one line per repeat, then the median
// Each repeat line also times `new Named` alone on the same subjects (`named`), the share of a cue
// the subject list, its places and its stagger answers take. PROF=<dir> CPU-profiles repeats
// PROFILE=<r>,... (default 8,12,16) into <dir>/cue-<r>.cpuprofile; NO_STAGGER=1 cues without one.
// CUES=k cues k such voices on each fresh mix, as gpu-reach's MIX=owned cues three per scene over
// one list of cells, and times each: `cue` is the first, `then` the median of the rest. FIRST=1 also
// times the first frame after them, a sync and a probe of every subject in list order (`first`),
// and profiles that frame rather than the cue.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { keys, kit, mix, sum } from '../dist/index.js';
import { Named } from '../dist/named.js';

const N = Number(process.argv[2] ?? 1e6);
const repeats = Number(process.argv[3] ?? 30);
const warm = Number(process.argv[4] ?? 5);
const staggered = !process.env.NO_STAGGER;
const profDir = process.env.PROF;
const profiled = (process.env.PROFILE ?? '8,12,16').split(',').map(Number);
const CUES = Number(process.env.CUES ?? 1);
const FIRST = Boolean(process.env.FIRST);

const stagger = (c) => (c.i % 256) * 4;
const K = kit({ x: sum() });
const nudge = keys(1000, [
  { at: 0, delta: { x: 0 } },
  { at: 0.5, delta: { x: 3 }, ease: 'ease-in-out' },
  { at: 1, delta: { x: 0 } },
]);
const cells = Array.from({ length: N }, (_, i) => ({ i }));

const session = profDir === undefined ? null : new Session();
if (session !== null) {
  session.connect();
  mkdirSync(profDir, { recursive: true });
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 100 });
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (x) => x.toFixed(3).padStart(8);
const cues = [];
const thens = [];
const firsts = [];
const nameds = [];
for (let r = 1; r <= warm + repeats; r++) {
  const m = mix(K, { name: 'cue-wide' });
  m.sync(0);
  const pf = session !== null && profiled.includes(r);
  if (pf && !FIRST) await session.post('Profiler.start');
  const a = performance.now();
  m.cue({
    patch: nudge,
    subjects: cells,
    stagger: staggered ? stagger : undefined,
    fade: { in: 300 },
  });
  const b = performance.now();
  if (pf && !FIRST) {
    const { profile } = await session.post('Profiler.stop');
    writeFileSync(`${profDir}/cue-${r}.cpuprofile`, JSON.stringify(profile));
  }
  const later = [];
  for (let k = 1; k < CUES; k++) {
    const t = performance.now();
    m.cue({
      patch: nudge,
      subjects: cells,
      stagger: staggered ? stagger : undefined,
      fade: { in: 300 },
    });
    later.push(performance.now() - t);
  }
  let first = Number.NaN;
  if (FIRST) {
    if (pf) await session.post('Profiler.start');
    const out = { x: 0 };
    const t = performance.now();
    m.sync(16);
    for (let i = 0; i < cells.length; i++) m.probe(cells[i], out);
    first = performance.now() - t;
    if (pf) {
      const { profile } = await session.post('Profiler.stop');
      writeFileSync(`${profDir}/first-${r}.cpuprofile`, JSON.stringify(profile));
    }
  }
  m.close();
  await new Promise((res) => setTimeout(res, 50));
  const c = performance.now();
  new Named(cells, staggered ? stagger : undefined);
  const d = performance.now();
  await new Promise((res) => setTimeout(res, 50));
  const tag = r > warm ? `${r - warm}/${repeats}` : `warm ${r}/${warm}`;
  const then = later.length > 0 ? `  then ${later.map(ms).join('')} ms` : '';
  const frame = FIRST ? `  first ${ms(first)} ms` : '';
  console.log(
    `${tag.padEnd(10)} N=${N}  cue ${ms(b - a)} ms  named ${ms(d - c)} ms${then}${frame}`,
  );
  if (r > warm) {
    cues.push(b - a);
    nameds.push(d - c);
    if (later.length > 0) thens.push(median(later));
    if (FIRST) firsts.push(first);
  }
}
const then = thens.length > 0 ? `  then ${ms(median(thens))} ms` : '';
const frame = FIRST ? `  first ${ms(median(firsts))} ms` : '';
console.log(
  `cue-wide N=${N}${staggered ? '' : ' no stagger'} CUES=${CUES}  cue ${ms(median(cues))} ms  named ${ms(median(nameds))} ms${then}${frame}  (medians of ${repeats})`,
);
