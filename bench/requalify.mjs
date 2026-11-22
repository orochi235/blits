// What a voice leaving the general path costs a crowd: N one-subject tweens read by `pull` each
// frame, and every EVERY frames a stateful `fn` voice on `gain`, which the tweens do not write, is
// cued on one subject for MS ms. Its cue takes it off lanes without a qualify, and since 2026-11-21
// so does its end, which requalified every voice before. Prints, per form, the mean frame, and the mean of frames a voice ended on against
// the rest (row `requalify-<form>-end`); `direct` times one `requalify` itself on the steady crowd,
// in ms. Lines read as bench/medians.mjs reads frame.mjs's. Needs `npx tsc -b` first.
//   node bench/requalify.mjs [N] [rounds] [forms...]   forms: quiet general direct
// OUT=<file> appends one JSON line a form and round.
import { appendFileSync } from 'node:fs';
import { kit, mix, mul, patch, sum, tween, vec } from '../dist/index.js';
import { requalify } from '../dist/qualify.js';

const N = Number(process.argv[2] ?? 10000);
const rounds = Number(process.argv[3] ?? 5);
const forms = process.argv.length > 4 ? process.argv.slice(4) : ['quiet', 'general', 'direct'];
const FRAMES = Number(process.env.FRAMES ?? 2000);
const EVERY = Number(process.env.EVERY ?? 10);
const MS = Number(process.env.MS ?? 40);
const OUT = process.env.OUT;
const K = kit({ gain: mul(), position: vec(3, sum()) });
const smooth = (u) => u * u * (3 - 2 * u);

/** A `fn` keeping state, which no lane runs. */
const stateful = () =>
  patch(
    MS,
    (ph, _s, c) => {
      c.state.last = 0.5 * c.state.last + ph;
      return { gain: 1 - 0.1 * c.state.last };
    },
    { writes: ['gain'], state: () => ({ last: 0 }) },
  );

function round(form) {
  const m = mix(K, { lanes: true });
  const subjects = Array.from({ length: N }, (_, j) => ({ seed: j * 0.37 }));
  for (const s of subjects)
    m.cue({
      patch: tween('position', { from: [0, 0, 0], to: [s.seed, 1, 0], ms: 1e9, ease: smooth }),
      subjects: [s],
    });
  const columns = { gain: new Float64Array(N), position: new Float64Array(N * 3) };
  let t = 0;
  for (let f = 0; f < 60; f++) {
    t += 16.7;
    m.sync(t);
    m.pull(subjects, columns);
  }
  if (form === 'direct') {
    const lanes = m.lanes;
    const calls = 200;
    const t0 = performance.now();
    for (let k = 0; k < calls; k++) requalify(lanes, m.version);
    return { us: ((performance.now() - t0) * 1000) / calls };
  }
  const each = new Float64Array(FRAMES);
  const ended = new Uint8Array(FRAMES);
  let live = null;
  let k = 0;
  for (let f = 0; f < FRAMES; f++) {
    const f0 = performance.now();
    t += 16.7;
    if (form === 'general' && f % EVERY === 0 && live === null)
      live = m.cue({ patch: stateful(), subjects: [subjects[(k++ * 7919) % N]] });
    m.sync(t);
    m.pull(subjects, columns);
    each[f] = performance.now() - f0;
    if (live !== null && live.state === 'done') {
      ended[f] = 1;
      live = null;
    }
  }
  let all = 0;
  let endSum = 0;
  let ends = 0;
  for (let f = 0; f < FRAMES; f++) {
    all += each[f];
    if (ended[f]) {
      endSum += each[f];
      ends++;
    }
  }
  return {
    ms: all / FRAMES,
    endMs: ends === 0 ? null : endSum / ends,
    restMs: (all - endSum) / (FRAMES - ends),
    ends,
  };
}

for (const form of forms)
  for (let r = 0; r < rounds; r++) {
    const res = { form, n: N, round: r + 1, rounds, frames: FRAMES, every: EVERY, ...round(form) };
    const f3 = (x) => (x === null || x === undefined ? '      -' : x.toFixed(3).padStart(7));
    const at = `${String(r + 1).padStart(2)}/${rounds}`;
    const row = (name, ms, rest = '') =>
      console.log(`${at}  requalify-${name.padEnd(11)} N=${N} V=1  ${f3(ms)} ms/frame${rest}`);
    if (form === 'direct') row('direct', res.us / 1000);
    else {
      row(form, res.ms);
      if (res.ends > 0) row(`${form}-end`, res.endMs, `  rest ${f3(res.restMs)}  ends ${res.ends}`);
    }
    if (OUT !== undefined) appendFileSync(OUT, `${JSON.stringify(res)}\n`);
  }
