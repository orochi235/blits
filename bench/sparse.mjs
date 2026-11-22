// Where a crowd of one-subject voices should stop filling: `pull` over an evenly spread share of N
// subjects, each with a voice of its own, with the crowd forced to fill every frame (`busy`), forced
// idle so the general path reads it (`idle`), or left to its line (`line`). Needs `npx tsc -b` first.
//   node bench/sparse.mjs <kind> <N> <rounds> <share>...
// Kinds: `tween`, `spring` and `keys` on a vec(3) channel, `fn` on a number. Each round runs the
// modes busy, idle, idle, busy, then line, so compare busy and idle within a run; MODES=line runs
// only the build's own line, for bench/ab.sh (`AB_BENCH=bench/sparse.mjs`).
// Rows `sparse-<kind>-<mode>@<share>`. OUT=<file> appends one JSON line a row and round.
import { appendFileSync } from 'node:fs';
import { keys, kit, mix, patch, spring, sum, tween, vec } from '../dist/index.js';
import { SPARSE } from '../dist/lane.js';

const [kind = 'tween', nArg = '10000', roundsArg = '3', ...shareArgs] = process.argv.slice(2);
const N = Number(nArg);
const rounds = Number(roundsArg);
const shares = shareArgs.length > 0 ? shareArgs.map(Number) : [0.5];
const FRAMES = Number(process.env.FRAMES ?? 1000);
const WARM = Number(process.env.WARM ?? 60);
const OUT = process.env.OUT;
const K = kit({ gain: sum(), position: vec(3, sum()) });
const LONG = 1e9;
const smooth = (u) => u * u * (3 - 2 * u);
// Every line a crowd may read, saved so a forced mode can overwrite them all and put them back.
const linesIn = (o) => ('stop' in o ? [o] : Object.values(o).flatMap(linesIn));
const lineSets = linesIn(SPARSE);
const saved = lineSets.map((l) => ({ ...l }));
const forced = { busy: { stop: -1, start: -1 }, idle: { stop: 2, start: 2 } };

const patchFor = {
  tween: (s) => tween('position', { from: [0, 0, 0], to: [s.seed, 1, 0], ms: LONG, ease: smooth }),
  spring: (s) => spring('position', { from: [0, 0, 0], to: [s.seed, 1, 0] }),
  keys: (s) =>
    keys(LONG, [
      { at: 0, delta: { position: [0, 0, 0] } },
      { at: 1, delta: { position: [s.seed, 1, 0] }, ease: smooth },
    ]),
  fn: (s) => patch(LONG, (ph) => ({ gain: s.seed * smooth(ph) }), { writes: ['gain'] }),
}[kind];
if (patchFor === undefined) throw new Error(`unknown kind ${kind}`);

function run(mode, share) {
  if (mode in forced) for (const l of lineSets) Object.assign(l, forced[mode]);
  const m = mix(K, { lanes: true, name: 'sparse' });
  const subjects = Array.from({ length: N }, (_, j) => ({ seed: j * 0.37 }));
  for (const s of subjects) m.cue({ patch: patchFor(s), subjects: [s] });
  const columns = { gain: new Float64Array(N), position: new Float64Array(N * 3) };
  let t = 16.7;
  m.sync(t);
  m.pull(subjects, columns);
  const list = subjects.filter((_, j) => Math.floor((j + 1) * share) > Math.floor(j * share));
  for (let f = 0; f < WARM; f++) {
    t += 16.7;
    m.sync(t);
    m.pull(list, columns);
  }
  const each = new Float64Array(FRAMES);
  for (let f = 0; f < FRAMES; f++) {
    const f0 = performance.now();
    t += 16.7;
    m.sync(t);
    m.pull(list, columns);
    each[f] = performance.now() - f0;
  }
  const ms = each.reduce((a, b) => a + b, 0) / FRAMES;
  each.sort();
  for (const [k, l] of lineSets.entries()) Object.assign(l, saved[k]);
  return { ms, p50: each[FRAMES >> 1], listed: list.length };
}

const order = process.env.MODES?.split(',') ?? ['busy', 'idle', 'idle', 'busy', 'line'];
const total = shares.length * rounds * order.length;
let done = 0;
for (const share of shares)
  for (let r = 0; r < rounds; r++)
    for (const mode of order) {
      const res = { kind, mode, share, n: N, round: r + 1, rounds, frames: FRAMES };
      Object.assign(res, run(mode, share));
      done++;
      console.log(
        `${String(done).padStart(3)}/${total}  sparse-${kind}-${mode}@${share.toFixed(2)} N=${N} V=1` +
          `  ${res.ms.toFixed(3).padStart(7)} ms/frame  p50 ${res.p50.toFixed(3).padStart(7)}` +
          `  listed ${String(res.listed).padStart(6)}`,
      );
      if (OUT !== undefined) appendFileSync(OUT, `${JSON.stringify(res)}\n`);
    }
