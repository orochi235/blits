// What holding N subject objects weakly costs, by the ways `Numbers.take` and `Store` do it: a
// WeakRef each, a FinalizationRegistry cell each with its WeakRef, its target or no unregister token, a WeakMap
// entry each, and a Map entry each for scale. A fresh structure every round; one line a round.
//   node bench/weakcost.mjs [N] [rounds]
const N = Number(process.argv[2] ?? 1e6);
const rounds = Number(process.argv[3] ?? 9);
const cells = Array.from({ length: N }, (_, i) => ({ i }));
const noop = () => {};
const variants = {
  weakRef: () => {
    const refs = new Array(N);
    for (let i = 0; i < N; i++) refs[i] = new WeakRef(cells[i]);
    return refs;
  },
  regToken: () => {
    const reg = new FinalizationRegistry(noop);
    const refs = new Array(N);
    for (let i = 0; i < N; i++) {
      const ref = new WeakRef(cells[i]);
      refs[i] = ref;
      reg.register(cells[i], i, ref);
    }
    return [reg, refs];
  },
  regTargetToken: () => {
    const reg = new FinalizationRegistry(noop);
    const refs = new Array(N);
    for (let i = 0; i < N; i++) {
      refs[i] = new WeakRef(cells[i]);
      reg.register(cells[i], i, cells[i]);
    }
    return [reg, refs];
  },
  regNoToken: () => {
    const reg = new FinalizationRegistry(noop);
    const refs = new Array(N);
    for (let i = 0; i < N; i++) {
      refs[i] = new WeakRef(cells[i]);
      reg.register(cells[i], i);
    }
    return [reg, refs];
  },
  weakMap: () => {
    const m = new WeakMap();
    for (let i = 0; i < N; i++) m.set(cells[i], i);
    return m;
  },
  map: () => {
    const m = new Map();
    for (let i = 0; i < N; i++) m.set(cells[i], i);
    return m;
  },
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const names = Object.keys(variants);
const times = Object.fromEntries(names.map((k) => [k, []]));
let keep = null;
for (let r = 1; r <= rounds; r++) {
  const order = r % 2 ? names : [...names].reverse();
  const line = [];
  for (const k of order) {
    keep = null;
    await new Promise((res) => setTimeout(res, 50));
    const a = performance.now();
    keep = variants[k]();
    const t = performance.now() - a;
    times[k].push(t);
    line.push(`${k} ${t.toFixed(1)}`);
  }
  console.log(`${r}/${rounds}  N=${N}  ${line.join('  ')} ms`);
}
console.log(
  `medians N=${N}: ${names.map((k) => `${k} ${median(times[k]).toFixed(1)}`).join('  ')} ms${keep ? '' : ''}`,
);
