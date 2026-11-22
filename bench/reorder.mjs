// What a list read out of its numbers' order costs `pull`: N one-subject tweens, numbered in cue
// order, read each frame as a list in another order. `pull` renumbers only a subject swap-remove
// moved into a freed number, so every other order reads as numbered. Needs `npx tsc -b` first.
//   node bench/reorder.mjs [N] [rounds] [forms...]
// Forms: `asc` cue order; `rev` reversed; `shuf` shuffled once; `half` every other subject;
// `swap` churn kept dense by swap-remove, which `pull` renumbers; `splice` churn kept in cue order
// by removing the dropped subject and appending the new one, as `filter` then `push` does.
// Lines read as bench/medians.mjs reads frame.mjs's. WARM=<frames> sets the untimed frames first. OUT=<file> appends one JSON line a form and round.
import { appendFileSync } from 'node:fs';
import { kit, mix, sum, tween, vec } from '../dist/index.js';

const N = Number(process.argv[2] ?? 10000);
const rounds = Number(process.argv[3] ?? 5);
const all = ['asc', 'rev', 'shuf', 'half', 'swap', 'splice'];
const forms = process.argv.length > 4 ? process.argv.slice(4) : all;
const FRAMES = Number(process.env.FRAMES ?? 3000);
const OUT = process.env.OUT;
const K = kit({ position: vec(3, sum()) });
const smooth = (u) => u * u * (3 - 2 * u);

function round(form) {
  const m = mix(K, { lanes: true });
  let next = 0;
  const handles = new Map();
  const cueOn = (s) =>
    handles.set(
      s,
      m.cue({
        patch: tween('position', { from: [0, 0, 0], to: [s.seed, 1, 0], ms: 1e9, ease: smooth }),
        subjects: [s],
      }),
    );
  const fresh = () => ({ seed: next++ * 0.37 });
  const subjects = Array.from({ length: N }, fresh);
  for (const s of subjects) cueOn(s);
  const columns = { position: new Float64Array(N * 3) };
  let t = 16.7;
  // Numbered in cue order by a first read in that order, then read in the form's.
  m.sync(t);
  m.pull(subjects, columns);
  let list = subjects.slice();
  if (form === 'rev') list.reverse();
  if (form === 'half') list = list.filter((_, j) => j % 2 === 0);
  if (form === 'shuf') {
    let seed = 1;
    for (let j = list.length - 1; j > 0; j--) {
      seed = (seed * 16807) % 2147483647;
      const k = seed % (j + 1);
      [list[j], list[k]] = [list[k], list[j]];
    }
  }
  let turn = 0;
  const churn = () => {
    if (form !== 'swap' && form !== 'splice') return;
    const k = (turn++ * 7919) % list.length;
    const gone = list[k];
    handles.get(gone).fade({ over: 0 });
    handles.delete(gone);
    m.drop(gone);
    const s = fresh();
    cueOn(s);
    list = list.slice();
    if (form === 'swap') {
      list[k] = list[list.length - 1];
      list[list.length - 1] = s;
    } else {
      list.splice(k, 1);
      list.push(s);
    }
  };
  // Long enough for `splice` to have churned most of the list before the timed frames.
  const warm = Number(process.env.WARM ?? (form === 'splice' || form === 'swap' ? N : 60));
  for (let f = 0; f < warm; f++) {
    t += 16.7;
    churn();
    m.sync(t);
    m.pull(list, columns);
  }
  const each = new Float64Array(FRAMES);
  for (let f = 0; f < FRAMES; f++) {
    const f0 = performance.now();
    t += 16.7;
    churn();
    m.sync(t);
    m.pull(list, columns);
    each[f] = performance.now() - f0;
  }
  const ms = each.reduce((a, b) => a + b, 0) / FRAMES;
  each.sort();
  return { ms, p50: each[FRAMES >> 1], listed: list.length };
}

for (const form of forms)
  for (let r = 0; r < rounds; r++) {
    const res = { form, n: N, round: r + 1, rounds, frames: FRAMES, ...round(form) };
    console.log(
      `${String(r + 1).padStart(2)}/${rounds}  ${form.padEnd(6)} N=${N} V=1` +
        `  ${res.ms.toFixed(3).padStart(7)} ms/frame  p50 ${res.p50.toFixed(3).padStart(7)}` +
        `  listed ${String(res.listed).padStart(6)}`,
    );
    if (OUT !== undefined) appendFileSync(OUT, `${JSON.stringify(res)}\n`);
  }
