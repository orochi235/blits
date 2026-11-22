// How many separate maps a stop and a steady frame touch, in bench/restart.mjs's shape: every
// Map, WeakMap and Set call inside one is counted by the map it hits and the line that made it,
// so a consolidation can be judged by what it takes off that list. Counts, not times.
//   node bench/stopmaps.mjs [N]    default 1000; ROUNDS (default 20) rounds of 100 stops
const dist = new URL('../dist/', import.meta.url);
const { kit, mix, sum, tween, vec } = await import(new URL('index.js', dist).href);

let on = false;
const maps = new Map(); // map object -> { sites: Set<site>, ops, size }
const sites = new Map(); // site -> calls
Error.stackTraceLimit = 30;
const site = () => {
  const lines = new Error().stack.split('\n');
  let inner;
  for (let i = 3; i < lines.length; i++) {
    const m = lines[i].match(/at (?:(\S+) \()?.*?([^/()]+\.js):(\d+)/);
    if (m === null || lines[i].includes('stopmaps.mjs')) continue;
    const at = `${m[1] ?? ''} ${m[2]}:${m[3]}`;
    if (m[2] === 'store.js' || m[2] === 'filed.js') {
      inner ??= at;
      continue;
    }
    return inner === undefined ? at : `${at} via ${inner}`;
  }
  return '?';
};
for (const C of [Map, WeakMap, Set, WeakSet])
  for (const op of ['get', 'set', 'has', 'delete', 'add']) {
    const fn = C.prototype[op];
    if (typeof fn !== 'function') continue;
    C.prototype[op] = function (...args) {
      if (on && this !== maps && this !== sites) {
        on = false;
        const s = `${C.name}.${op} ${site()}`;
        sites.set(s, (sites.get(s) ?? 0) + 1);
        let e = maps.get(this);
        if (e === undefined) {
          e = { sites: new Set(), ops: 0, size: 0 };
          maps.set(this, e);
        }
        e.sites.add(s);
        e.ops++;
        e.size = this.size ?? -1;
        on = true;
      }
      return fn.apply(this, args);
    };
  }

const n = Number(process.argv[2] ?? 1000);
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const m = mix(kit({ v: vec(2, sum()) }));
let t = 0;
m.sync(t);
let ids = 0;
let keys = [];
const handles = [];
let cols = { v: new Float64Array(0) };
const waiting = [];
const stop = (i) => {
  handles[i].fade({ over: 0 });
  m.drop(keys[i]);
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

const report = (what, per) => {
  const big = [...maps.values()].filter((e) => e.size >= n / 2).length;
  console.log(
    `${what}: ${maps.size} distinct maps touched over ${per} (${big} holding >= N/2 entries), ` +
      `${[...sites.values()].reduce((a, b) => a + b, 0) / per} calls each`,
  );
  for (const [s, c] of [...sites].sort((a, b) => b[1] - a[1]))
    console.log(`  ${(c / per).toFixed(2).padStart(7)}  ${s}`);
  for (const e of [...maps.values()].filter((e) => e.size >= n / 2))
    console.log(`  big map (${e.size}): ${[...e.sites].join(', ')}`);
  maps.clear();
  sites.clear();
};

let turn = 0;
for (let r = 0; r < ROUNDS; r++) {
  on = true;
  for (let i = 0; i < 100; i++) stop((turn++ * 7919) % keys.length);
  on = false;
  for (let i = 0; i < 100; i++) waiting.push(ids++);
  frame();
  frame();
}
report(`N=${n} stop`, ROUNDS * 100);
// One stop alone, for the distinct maps a single stop reaches.
on = true;
stop((turn++ * 7919) % keys.length);
on = false;
report(`N=${n} one stop`, 1);
waiting.push(ids++);
frame();
frame();
on = true;
for (let r = 0; r < ROUNDS; r++) frame();
on = false;
report(`N=${n} steady frame`, ROUNDS);
