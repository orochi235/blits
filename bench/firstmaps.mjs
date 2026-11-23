// What a subject's first read holds it in, in bench/cue-wide.mjs's FIRST=1 shape: every Map,
// WeakMap and Set call, WeakRef made and FinalizationRegistry cell registered during the first
// sync and probe of every subject is counted by the line that made it. Counts, not times.
//   node bench/firstmaps.mjs [N] [CUES]    default 10000 subjects, 1 voice
const dist = new URL('../dist/', import.meta.url);
const { keys, kit, mix, sum } = await import(new URL('index.js', dist).href);

let on = false;
const sites = new Map(); // site -> calls
Error.stackTraceLimit = 30;
const site = () => {
  const lines = new Error().stack.split('\n');
  let inner;
  for (let i = 3; i < lines.length; i++) {
    const m = lines[i].match(/at (?:(\S+) \()?.*?([^/()]+\.js):(\d+)/);
    if (m === null || lines[i].includes('firstmaps.mjs')) continue;
    const at = `${m[1] ?? ''} ${m[2]}:${m[3]}`;
    if (m[2] === 'store.js') {
      inner ??= at;
      continue;
    }
    return inner === undefined ? at : `${at} via ${inner}`;
  }
  return '?';
};
const count = (name) => {
  on = false;
  const s = `${name} ${site()}`;
  sites.set(s, (sites.get(s) ?? 0) + 1);
  on = true;
};
for (const C of [Map, WeakMap, Set, WeakSet])
  for (const op of ['set', 'add', 'get', 'has']) {
    const fn = C.prototype[op];
    if (typeof fn !== 'function') continue;
    C.prototype[op] = function (...args) {
      if (on && this !== sites) count(`${C.name}.${op}`);
      return fn.apply(this, args);
    };
  }
const register = FinalizationRegistry.prototype.register;
FinalizationRegistry.prototype.register = function (...args) {
  if (on) count('FinalizationRegistry.register');
  return register.apply(this, args);
};
const NativeWeakRef = globalThis.WeakRef;
globalThis.WeakRef = class extends NativeWeakRef {
  constructor(x) {
    super(x);
    if (on) count('new WeakRef');
  }
};

const N = Number(process.argv[2] ?? 10000);
const CUES = Number(process.argv[3] ?? 1);
const K = kit({ x: sum() });
const nudge = keys(1000, [
  { at: 0, delta: { x: 0 } },
  { at: 0.5, delta: { x: 3 }, ease: 'ease-in-out' },
  { at: 1, delta: { x: 0 } },
]);
const cells = Array.from({ length: N }, (_, i) => ({ i }));
const m = mix(K, { name: 'firstmaps' });
m.sync(0);
for (let k = 0; k < CUES; k++)
  m.cue({ patch: nudge, subjects: cells, stagger: (c) => (c.i % 256) * 4, fade: { in: 300 } });
const out = { x: 0 };
on = true;
m.sync(16);
for (let i = 0; i < cells.length; i++) m.probe(cells[i], out);
on = false;
console.log(`firstmaps N=${N} CUES=${CUES}: calls per subject by site, first sync and probe`);
for (const [s, c] of [...sites].sort((a, b) => b[1] - a[1]))
  if (c >= N / 10) console.log(`${(c / N).toFixed(2).padStart(6)}  ${s}`);
