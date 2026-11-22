// How long building a lookup of N distinct subject objects takes, by the ways `Named` could build
// one: a Map of places set in a loop (as it does), a Set from the array's constructor, a Set added
// in a loop, the stagger loop alone, and a built Map looked up in order (`mapGet`). One line a round.
//   node bench/places.mjs [N] [rounds]
const N = Number(process.argv[2] ?? 1e6);
const rounds = Number(process.argv[3] ?? 15);
const cells = Array.from({ length: N }, (_, i) => ({ i }));
const built = new Map();
for (let i = 0; i < cells.length; i++) built.set(cells[i], i);
const variants = {
  mapLoop: () => {
    const m = new Map();
    for (let i = 0; i < cells.length; i++) m.set(cells[i], i);
    return m.size;
  },
  setCtor: () => new Set(cells).size,
  setLoop: () => {
    const s = new Set();
    for (let i = 0; i < cells.length; i++) s.add(cells[i]);
    return s.size;
  },
  stagger: () => {
    const o = new Float64Array(cells.length);
    for (let i = 0; i < cells.length; i++) o[i] = (cells[i].i % 256) * 4;
    return o.length;
  },
  mapGet: () => {
    let t = 0;
    for (let i = 0; i < cells.length; i++) t += built.get(cells[i]);
    return t;
  },
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const names = Object.keys(variants);
const times = Object.fromEntries(names.map((k) => [k, []]));
for (let r = 1; r <= rounds; r++) {
  const order = r % 2 ? names : [...names].reverse();
  const line = [];
  for (const k of order) {
    const a = performance.now();
    variants[k]();
    const t = performance.now() - a;
    times[k].push(t);
    line.push(`${k} ${t.toFixed(2)}`);
    await new Promise((res) => setTimeout(res, 30));
  }
  console.log(`${r}/${rounds}  N=${N}  ${line.join('  ')} ms`);
}
console.log(
  `medians N=${N}: ${names.map((k) => `${k} ${median(times[k]).toFixed(2)}`).join('  ')} ms`,
);
