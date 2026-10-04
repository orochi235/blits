// Heap per voice of one subject each, by form: after cueing, after the first frame, after a second,
// and once the mix is let go (which should return to where it started).
//   node --expose-gc bench/memory.mjs [N] [forms...]   forms: tweens springs fns keyses named targets (a fn voice per subject picked by target, not in the default list: it grows with the square)
import { keys, kit, max, mix, mul, patch, spring, sum, tween, vec } from '../dist/index.js';

const N = Number(process.argv[2] ?? 10000);
const all = ['tweens', 'springs', 'fns', 'keyses', 'named'];
const forms = process.argv.length > 3 ? process.argv.slice(3) : all;
const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()) });
const smooth = (u) => u * u * (3 - 2 * u);
const make = {
  tweens: (s) => tween('position', { from: [0, 0, 0], to: [s.seed, 1, 0], ms: 1e4, ease: smooth }),
  springs: (s) => spring('position', { from: [0, 0, 0], to: [s.seed, 1, 0] }),
  fns: (s) => patch(1e4, (ph) => ({ position: [s.seed * ph, ph, 0] }), { writes: ['position'] }),
  keyses: (s) =>
    keys(1e4, [
      { at: 0, delta: { position: [0, 0, 0] } },
      { at: 1, delta: { position: [s.seed, 1, 0] }, ease: smooth },
    ]),
  named: () =>
    patch(180, (ph, s) => ({ gain: 0.5 + ph * s.seed, dark: ph * 0.1 }), {
      writes: ['gain', 'dark'],
    }),
};

// A WeakRef keeps its target until the job that made or read it ends, so collect after a turn.
const heap = async () => {
  await new Promise((r) => setTimeout(r, 0));
  globalThis.gc();
  globalThis.gc();
  return process.memoryUsage().heapUsed;
};
const per = (bytes) => `${(bytes / N).toFixed(0).padStart(6)} B`;

for (const [i, form] of forms.entries()) {
  const base = await heap();
  const subjects = Array.from({ length: N }, (_, j) => ({ seed: j * 0.37 }));
  const withSubjects = await heap();
  let m = mix(K);
  for (const s of subjects)
    m.cue(
      form === 'targets'
        ? { patch: make.named(), target: (x) => x === s }
        : { patch: make[form](s), subjects: [s] },
    );
  const cued = await heap();
  const out = {};
  m.sync(16);
  for (const s of subjects) m.probe(s, out);
  const first = await heap();
  m.sync(32);
  for (const s of subjects) m.probe(s, out);
  const second = await heap();
  m = null;
  const gone = await heap();
  console.log(
    `${i + 1}/${forms.length}  ${form.padEnd(8)} per voice: cued ${per(cued - withSubjects)}  first frame ${per(first - withSubjects)}  second ${per(second - withSubjects)}  let go ${per(gone - withSubjects)}  (base ${(base / 1e6).toFixed(1)} MB)`,
  );
  m = subjects.length; // keeps subjects alive to here
}
