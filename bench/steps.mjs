// How many times a seek back and its return step each subject again, and what the mix holds for
// it: the `seek` row's mix, or the `kept` row's, which never seeks, counting the row's own `step`.
//   node --expose-gc bench/steps.mjs [seek|kept] [every] [frames] [subjects]
// Prints the steps a subject at a few frames, their mean, the heap a subject holds at the end
// (with --expose-gc), and the state one subject reached, which is the same in every case.
import { createHistory } from '@weasel-js/history';
import { kit, max, mix, mul, patch } from '../dist/index.js';

const kind = process.argv[2] ?? 'seek';
const every = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
const frames = Number(process.argv[4] ?? 300);
const n = Number(process.argv[5] ?? 100);
const heap = () => {
  globalThis.gc?.();
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
};
const before = heap();
let steps = 0;
const drift = patch(0, (_p, _s, st) => ({ dark: st.state.x }), {
  writes: ['dark'],
  state: () => ({ x: 0 }),
  step: (st, dt) => {
    steps++;
    st.x += (1 - st.x) * Math.min(1, dt / 400);
  },
});
const m = mix(kit({ gain: mul(), dark: max() }), {
  history: { ms: 5000, every, tape: createHistory },
  stepMs: 5,
});
const subjects = Array.from({ length: n }, (_, j) => ({ seed: j }));
m.cue({ patch: drift, fade: { in: 100 }, loop: true });
const scratch = {};
let t = 0;
for (let f = 0; f < 30; f++) {
  t += 16.7;
  m.sync(t);
  for (const s of subjects) m.probe(s, scratch);
}
const shown = [];
let sum = 0;
for (let f = 0; f < frames; f++) {
  t += 16.7;
  steps = 0;
  if (kind === 'seek') {
    const now = m.now;
    m.seek(now - 300);
    m.seek(now);
  }
  m.sync(t);
  for (const s of subjects) m.probe(s, scratch);
  sum += steps / n;
  if (f < 3 || (f + 1) % 100 === 0) shown.push(`${f + 1}: ${(steps / n).toFixed(1)}`);
}
const x = m.probe(subjects[0], {}).dark;
const held =
  globalThis.gc === undefined ? '' : ` heap ${((heap() - before) / n).toFixed(0)} B a subject;`;
console.log(
  `${kind}, every ${every ?? 'default'}: steps a subject at frame ${shown.join(', ')};` +
    ` mean ${(sum / frames).toFixed(1)};${held} x ${x}`,
);
