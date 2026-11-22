// What a voice leaving the general path costs a crowd: N one-subject tweens read by `pull` each
// frame, and every EVERY frames a stateful `fn` voice on `gain`, which the tweens do not write, is
// cued on one subject for MS ms. Its cue takes it off lanes without a qualify, and since 2026-11-21
// so does its end, which requalified every voice before. Prints, per form, the mean frame, and the
// mean of frames a voice ended on and of the rest (rows `requalify-<form>-end` and `-rest`);
// `direct` times one `requalify` itself on the steady crowd, in ms. `unnamed` cues the voice over
// every subject, `within` over every subject but bounded to a ball of radius R (3) on a square grid,
// and both print the frames it plays (`-play`), ends on (`-end`) and the rest (`-idle`). `atrest-quiet` and
// `atrest-named` ask `atRest` of every subject after each pull, with no voice off lanes or with one
// named voice off lanes playing throughout, and print that call alone (`-ask`).
// Lines read as bench/medians.mjs reads frame.mjs's. Needs `npx tsc -b` first.
//   node bench/requalify.mjs [N] [rounds] [forms...]
//   forms: quiet general direct unnamed within atrest-quiet atrest-named
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
const R = Number(process.env.R ?? 3);

/** A `fn` keeping state, which no lane runs. */
const stateful = (ms = MS) =>
  patch(
    ms,
    (ph, _s, c) => {
      c.state.last = 0.5 * c.state.last + ph;
      return { gain: 1 - 0.1 * c.state.last };
    },
    { writes: ['gain'], state: () => ({ last: 0 }) },
  );

function round(form) {
  const m = mix(K, { lanes: true });
  const subjects = Array.from({ length: N }, (_, j) => ({ seed: j * 0.37 }));
  const side = Math.ceil(Math.sqrt(N));
  const pointer = { x: side / 2, y: side / 2, r: R };
  if (form === 'within') {
    const xy = new Float64Array(2 * N);
    for (let j = 0; j < N; j++) {
      xy[2 * j] = j % side;
      xy[2 * j + 1] = Math.floor(j / side);
    }
    m.plot(subjects, xy, { cell: R });
  }
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
  const asking = form === 'atrest-quiet' || form === 'atrest-named';
  if (form === 'atrest-named') m.cue({ patch: stateful(1e9), subjects: [subjects[(N * 7) >> 4]] });
  const each = new Float64Array(FRAMES);
  const ended = new Uint8Array(FRAMES);
  const played = new Uint8Array(FRAMES);
  let asked = 0;
  let resting = 0;
  let live = null;
  let k = 0;
  for (let f = 0; f < FRAMES; f++) {
    const f0 = performance.now();
    t += 16.7;
    if (f % EVERY === 0 && live === null) {
      if (form === 'general')
        live = m.cue({ patch: stateful(), subjects: [subjects[(k++ * 7919) % N]] });
      else if (form === 'unnamed') live = m.cue({ patch: stateful() });
      else if (form === 'within') {
        const a = k++ * 0.7;
        pointer.x = side / 2 + (side / 3) * Math.cos(a);
        pointer.y = side / 2 + (side / 3) * Math.sin(a);
        live = m.cue({ patch: stateful(), weight: m.around(pointer) });
      }
    }
    m.sync(t);
    played[f] = live !== null && live.state !== 'done' ? 1 : 0;
    m.pull(subjects, columns);
    each[f] = performance.now() - f0;
    if (asking) {
      const a0 = performance.now();
      for (let j = 0; j < N; j++) if (m.atRest(subjects[j])) resting++;
      asked += performance.now() - a0;
    }
    if (live !== null && live.state === 'done') {
      ended[f] = 1;
      live = null;
    }
  }
  let all = 0;
  let endSum = 0;
  let ends = 0;
  let playSum = 0;
  let plays = 0;
  for (let f = 0; f < FRAMES; f++) {
    all += each[f];
    if (ended[f]) {
      endSum += each[f];
      ends++;
    }
    if (played[f]) {
      playSum += each[f];
      plays++;
    }
  }
  return {
    ms: all / FRAMES,
    endMs: ends === 0 ? null : endSum / ends,
    restMs: (all - endSum) / (FRAMES - ends),
    ends,
    playMs: plays === 0 ? null : playSum / plays,
    idleMs: plays + ends === FRAMES ? null : (all - playSum - endSum) / (FRAMES - plays - ends),
    plays,
    askMs: asking ? asked / FRAMES : null,
    resting: asking ? resting / FRAMES : null,
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
    else if (form === 'unnamed' || form === 'within') {
      row(form, res.ms, `  plays ${res.plays}`);
      if (res.plays > 0) row(`${form}-play`, res.playMs);
      if (res.ends > 0) row(`${form}-end`, res.endMs, `  ends ${res.ends}`);
      if (res.idleMs !== null) row(`${form}-idle`, res.idleMs);
    } else if (res.askMs !== null) {
      row(form, res.ms);
      row(`${form}-ask`, res.askMs, `  resting ${res.resting.toFixed(0)}`);
    } else {
      row(form, res.ms);
      if (res.ends > 0) {
        row(`${form}-end`, res.endMs, `  rest ${f3(res.restMs)}  ends ${res.ends}`);
        row(`${form}-rest`, res.restMs);
      }
    }
    if (OUT !== undefined) appendFileSync(OUT, `${JSON.stringify(res)}\n`);
  }
