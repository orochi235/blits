// Where starting N one-subject voices allocates, garbage included: the inspector's sampling heap
// profiler over cue, first sync and a probe of every subject, bytes per voice by allocating
// function, worst first.
//   node bench/allocwho.mjs [N] [form] [rounds]   form: tweens (default) fns
// CALLERS=<name> also prints the call stacks under which functions of that name allocate.
import { Session } from 'node:inspector/promises';
import { kit, max, mix, mul, patch, sum, tween, vec } from '../dist/index.js';

const N = Number(process.argv[2] ?? 10000);
const form = process.argv[3] ?? 'tweens';
const rounds = Number(process.argv[4] ?? 5);
const TOP = Number(process.env.TOP ?? 30);
const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()) });
const smooth = (u) => u * u * (3 - 2 * u);
const make = {
  tweens: (s) => tween('position', { from: [0, 0, 0], to: [s.seed, 1, 0], ms: 1e4, ease: smooth }),
  fns: (s) =>
    patch(1e4, (ph) => ({ position: [s.seed * smooth(ph), smooth(ph), 0] }), {
      writes: ['position'],
    }),
};
const round = () => {
  const m = mix(K);
  const subjects = Array.from({ length: N }, (_, j) => ({ seed: j * 0.37 }));
  const out = {};
  for (const s of subjects) m.cue({ patch: make[form](s), subjects: [s], loop: true });
  m.sync(16);
  for (const s of subjects) m.probe(s, out);
};
round();
const session = new Session();
session.connect();
await session.post('HeapProfiler.enable');
await session.post('HeapProfiler.startSampling', {
  samplingInterval: 256,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});
for (let r = 0; r < rounds; r++) round();
const { profile } = await session.post('HeapProfiler.stopSampling');
const by = new Map();
const stacks = new Map();
const callers = process.env.CALLERS;
let total = 0;
const walk = (node, stack) => {
  const f = node.callFrame;
  const name = `${f.functionName || '(anon)'}  ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  const self = node.selfSize;
  if (self > 0) {
    by.set(name, (by.get(name) ?? 0) + self);
    total += self;
    if (callers !== undefined && f.functionName === callers) {
      const key = stack.slice(-4).join(' < ');
      stacks.set(key, (stacks.get(key) ?? 0) + self);
    }
  }
  const short = `${f.functionName || '(anon)'}@${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  for (const c of node.children) walk(c, [...stack, short]);
};
walk(profile.head, []);
const per = (b) => (b / rounds / N).toFixed(0).padStart(6);
console.log(`${form} N=${N}: ${per(total)} B a voice allocated over cue and first frame`);
for (const [name, b] of [...by].sort((a, b) => b[1] - a[1]).slice(0, TOP))
  console.log(`${per(b)} B  ${((100 * b) / total).toFixed(1).padStart(5)}%  ${name}`);
if (callers !== undefined) {
  console.log(`under ${callers}:`);
  for (const [key, b] of [...stacks].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`${per(b)} B  ${key.split(' < ').reverse().join(' < ')}`);
}
