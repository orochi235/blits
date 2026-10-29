// What each part of a stop costs, inclusive, in bench/restart.mjs's shape: prototype methods a
// stop calls are wrapped in a timer that counts only inside a stop, so the parts at 1,000 and
// 40,000 subjects show which grow. The wrapper itself costs about a timer read a call, so read the
// growth, not the level; a store's calls are told apart by which of the mix's stores it is.
//   node bench/stopparts.mjs [N...]    default 1000 40000; ROUNDS (default 300) rounds a size
const dist = new URL('../dist/', import.meta.url);
const load = (f) => import(new URL(f, dist).href);
const { kit, mix, sum, tween, vec } = await load('index.js');
const { Mixer } = await load('mixer.js');
const { Lanes } = await load('lanes.js');
const { Numbers } = await load('numbers.js');
const { Store } = await load('store.js');
const { Motions } = await load('motions.js');
const { Placed } = await load('placed.js');

let inStop = false;
let current = null;
const spent = new Map();
const add = (key, us) => spent.set(key, (spent.get(key) ?? 0) + us);
const now = () => performance.now();
function wrap(proto, name, label, keyOf) {
  const fn = proto[name];
  if (typeof fn !== 'function') return;
  proto[name] = function (...args) {
    if (!inStop) return fn.apply(this, args);
    const t = now();
    try {
      return fn.apply(this, args);
    } finally {
      add(keyOf === undefined ? label : keyOf(this, label), (now() - t) * 1000);
    }
  };
}
const storeName = (s, op) => {
  const m = current;
  if (m === null) return `Store.${op} other`;
  if (s === m.chains) return `Store.${op} chains`;
  if (s === m.named) return `Store.${op} named`;
  if (s === m.lastPoses) return `Store.${op} lastPoses`;
  if (s === m.strays) return `Store.${op} strays`;
  return `Store.${op} other`;
};
for (const n of ['drop', 'forgetIn', 'releaseIn']) wrap(Mixer.prototype, n, `Mixer.${n}`);
for (const n of ['release', 'forget', 'voiceChanged', 'touch', 'refill', 'invalidate'])
  wrap(Lanes.prototype, n, `Lanes.${n}`);
wrap(Numbers.prototype, 'release', 'Numbers.release');
wrap(Placed.prototype, 'remove', 'Placed.remove');
for (const n of ['release', 'forget', 'known']) wrap(Motions.prototype, n, `Motions.${n}`);
for (const n of ['get', 'delete']) wrap(Store.prototype, n, n, (s) => storeName(s, n));

const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1000, 40000];
const ROUNDS = Number(process.env.ROUNDS ?? 300);
const run = (n, quiet) => {
  const m = mix(kit({ v: vec(2, sum()) }));
  let t = 0;
  m.sync(t);
  let ids = 0;
  let keys = [];
  const handles = [];
  let cols = { v: new Float64Array(0) };
  const waiting = [];
  let fadeUs = 0;
  let dropUs = 0;
  const stop = (i) => {
    inStop = true;
    const a = now();
    handles[i].fade({ over: 0 });
    const b = now();
    m.drop(keys[i]);
    const c = now();
    inStop = false;
    fadeUs += (b - a) * 1000;
    dropUs += (c - b) * 1000;
    const last = keys.length - 1;
    keys[i] = keys[last];
    handles[i] = handles[last];
    keys.pop();
    handles.pop();
  };
  const frame = () => {
    if (waiting.length > 0) {
      keys = keys.slice();
      for (const key of waiting) {
        const patch = tween('v', { from: [key, 0], to: [key, 0], ms: 1e9 });
        handles.push(m.cue({ patch, subjects: [key] }));
        patch.to(key, [key + 500, 100], 0);
        keys.push(key);
      }
      waiting.length = 0;
      if (cols.v.length !== keys.length * 2) cols = { v: new Float64Array(keys.length * 2) };
    }
    t += 16;
    m.sync(t);
    m.pull(keys, cols);
  };
  for (let i = 0; i < n; i++) waiting.push(ids++);
  for (let i = 0; i < 50; i++) frame();
  // The mix's own stores, found by the wrapper; `m` is the public mix, its fields the Mixer's.
  current = m;
  spent.clear();
  let turn = 0;
  for (let r = 0; r < ROUNDS; r++) {
    for (let i = 0; i < 100; i++) stop((turn++ * 7919) % keys.length);
    for (let i = 0; i < 100; i++) waiting.push(ids++);
    frame();
    frame();
  }
  if (quiet) return;
  const stops = ROUNDS * 100;
  const f = (us) => (us / stops).toFixed(3).padStart(7);
  console.log(`N=${n}  fade ${f(fadeUs)} µs  drop ${f(dropUs)} µs a stop`);
  for (const [k, us] of [...spent].sort((a, b) => b[1] - a[1])) console.log(`  ${f(us)}  ${k}`);
};
run(200, true);
for (const n of sizes) run(n, false);
