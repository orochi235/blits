// Compares levelsOf's hashing variants on 1M delays shaped as bench/gpu-stock.mjs MIX=stagger.
const MOST = 4096,
  SLOTS = MOST * 2,
  SHIFT = 32 - Math.log2(SLOTS);
const bits = new Float64Array(1),
  words = new Uint32Array(bits.buffer);
function old(delays) {
  const n = delays.length,
    codes = new Uint16Array(n + (n & 1)),
    values = new Float64Array(MOST),
    slots = new Uint16Array(SLOTS);
  let size = 0;
  for (let i = 0; i < n; i++) {
    const d = delays[i];
    bits[0] = d;
    let h = Math.imul(words[0] ^ words[1], 0x9e3779b1) >>> SHIFT,
      level;
    for (;;) {
      const s = slots[h];
      if (s === 0) {
        if (size === MOST) return null;
        level = size++;
        values[level] = d;
        slots[h] = size;
        break;
      }
      if (values[s - 1] === d) {
        level = s - 1;
        break;
      }
      h = (h + 1) & (SLOTS - 1);
    }
    codes[i] = level;
  }
  return codes;
}
function view(delays) {
  const n = delays.length,
    codes = new Uint16Array(n + (n & 1)),
    values = new Float64Array(MOST),
    slots = new Uint16Array(SLOTS);
  const w = new Uint32Array(delays.buffer, delays.byteOffset, n * 2);
  let size = 0;
  for (let i = 0; i < n; i++) {
    const d = delays[i];
    let h = Math.imul(w[2 * i] ^ w[2 * i + 1], 0x9e3779b1) >>> SHIFT,
      level;
    for (;;) {
      const s = slots[h];
      if (s === 0) {
        if (size === MOST) return null;
        level = size++;
        values[level] = d;
        slots[h] = size;
        break;
      }
      if (values[s - 1] === d) {
        level = s - 1;
        break;
      }
      h = (h + 1) & (SLOTS - 1);
    }
    codes[i] = level;
  }
  return codes;
}
function last(delays) {
  const n = delays.length,
    codes = new Uint16Array(n + (n & 1)),
    values = new Float64Array(MOST),
    slots = new Uint16Array(SLOTS);
  const w = new Uint32Array(delays.buffer, delays.byteOffset, n * 2);
  let size = 0,
    prev = Number.NaN,
    pl = 0;
  for (let i = 0; i < n; i++) {
    const d = delays[i];
    if (d === prev) {
      codes[i] = pl;
      continue;
    }
    let h = Math.imul(w[2 * i] ^ w[2 * i + 1], 0x9e3779b1) >>> SHIFT,
      level;
    for (;;) {
      const s = slots[h];
      if (s === 0) {
        if (size === MOST) return null;
        level = size++;
        values[level] = d;
        slots[h] = size;
        break;
      }
      if (values[s - 1] === d) {
        level = s - 1;
        break;
      }
      h = (h + 1) & (SLOTS - 1);
    }
    codes[i] = level;
    prev = d;
    pl = level;
  }
  return codes;
}
function int(delays) {
  const n = delays.length,
    codes = new Uint16Array(n + (n & 1)),
    values = new Float64Array(MOST),
    slots = new Uint16Array(SLOTS);
  const w = new Uint32Array(delays.buffer, delays.byteOffset, n * 2);
  let size = 0;
  for (let i = 0; i < n; i++) {
    const d = delays[i];
    let h = Math.imul(w[2 * i] ^ w[2 * i + 1], 0x9e3779b1) >>> SHIFT,
      level;
    let s = slots[h];
    if (s !== 0 && values[s - 1] === d) {
      codes[i] = s - 1;
      continue;
    }
    for (;;) {
      s = slots[h];
      if (s === 0) {
        if (size === MOST) return null;
        level = size++;
        values[level] = d;
        slots[h] = size;
        break;
      }
      if (values[s - 1] === d) {
        level = s - 1;
        break;
      }
      h = (h + 1) & (SLOTS - 1);
    }
    codes[i] = level;
  }
  return codes;
}
const N = 1_000_000;
const shapes = {
  mod256: Float64Array.from({ length: N }, (_, i) => (i % 256) * 4),
  groups: Float64Array.from({ length: N }, (_, i) => Math.floor(i / 1000) * 3.5),
  rand64: Float64Array.from({ length: N }, () => Math.floor(Math.random() * 64) * 16.7),
};
const fns = { old, view, last, int };
const ref = Object.fromEntries(Object.entries(shapes).map(([k, d]) => [k, old(d)]));
for (const [k, d] of Object.entries(shapes))
  for (const [f, fn] of Object.entries(fns)) {
    const c = fn(d);
    if (c.some((v, i) => v !== ref[k][i])) throw new Error(`${f} wrong on ${k}`);
  }
const rounds = 7,
  rec = [];
for (let r = 0; r < rounds; r++)
  for (const [k, d] of Object.entries(shapes))
    for (const [f, fn] of Object.entries(fns)) {
      const t = [];
      for (let j = 0; j < 15; j++) {
        const a = performance.now();
        fn(d);
        t.push(performance.now() - a);
      }
      t.sort((a, b) => a - b);
      rec.push({ round: r, shape: k, fn: f, ms: t });
      console.log(
        `${r + 1}/${rounds} ${k.padEnd(7)} ${f.padEnd(5)} ${t[7].toFixed(3).padStart(7)} ms`,
      );
    }
const fs = await import('node:fs');
fs.writeFileSync(
  process.env.OUT ?? 'levels-hash.jsonl',
  rec.map((x) => JSON.stringify(x)).join('\n') + '\n',
);
