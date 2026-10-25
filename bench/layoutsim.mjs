// A model of `bareRows` over 10,000 landed tween rows, outside blits, to ask what its frame costs:
// the layout it reads, or the checks it makes. `node bench/layoutsim.mjs <variant>`, BARE=1 for the
// row loop alone without the fill and pull around it. bench/runs/2026-10-25-layoutsim.txt has runs
// and names the variants.
const N = 10000;
const n = 3;
const FR = Number(process.env.FRAMES ?? 5000);
const STRIDE = 8;
const SLOT = 6;
const HS = 10 + 3 * n;
const data = new Float64Array(N * STRIDE);
const hot = new Float64Array(N * HS);
const per = new Float64Array(N * SLOT);
const values = new Float64Array(N * n);
const out = new Float64Array(N * n);
const list = Array.from({ length: N }, (_, j) => j);
const smooth = (u) => u * u * (3 - 2 * u);
const eases = Array.from({ length: N }, () => smooth);
const memo = { u: Number.NaN, ease: undefined, left: 0 };
function left(ease, u) {
  if (u !== memo.u || ease !== memo.ease) {
    memo.u = u;
    memo.ease = ease;
    memo.left = u >= 1 ? 0 : 1 - ease(u);
  }
  return memo.left;
}
const between = (x0, g, s) => (s === 0 ? g : g + (x0 - g) * s);
const fold = (op, acc, v, w) => (op === 'sum' ? acc + v * w : op === 'mul' ? acc * v : +v);
for (let p = 0; p < N; p++) {
  const h = p * HS;
  hot[h] = 2 | 1 | 8 | 16 | 32 | 128 | 1024;
  hot[h + 1] = 0;
  hot[h + 2] = 0;
  hot[h + 3] = 1;
  hot[h + 4] = 1;
  hot[h + 7] = p;
  hot[h + 8] = 0;
  hot[h + 9] = 10000;
  hot[h + 10] = 0;
  hot[h + 16] = p * 0.37;
  hot[h + 17] = 1;
  data[p * STRIDE + 4] = p;
  data[p * STRIDE + 7] = 1;
}
const WANT = 2 | 1 | 8 | 16 | 32 | 128 | 1024;
let fills = 0;
function current(now) {
  const op = 'sum';
  for (let p = 0; p < N; p++) {
    const h = p * HS;
    if (hot[h + 7] >= Infinity || (hot[h] & 0x7fb) !== WANT) break;
    const o = p * STRIDE;
    if (data[o + 4] < 0 || data[o + 7] === 0) break;
    const slot = list[p];
    const q = slot * SLOT;
    const el = hot[h + 2] + (now - hot[h + 1]) * hot[h + 3] - data[o];
    if (!(el >= 0)) break;
    if (per[q + 5] === fills - 1) data[o + 3] = data[o + 2];
    const w = hot[h + 4];
    data[o + 2] = w;
    if (data[o + 5] !== -2) data[o + 5] = -2;
    if (w <= 0) continue;
    const share = left(eases[p], Math.max(0, el - hot[h + 8]) / hot[h + 9]);
    const base = slot * n;
    const x = h + 10;
    const g = x + 2 * n;
    for (let a = 0; a < n; a++)
      values[base + a] = fold(op, values[base + a], between(hot[x + a], hot[g + a], share), w);
  }
}
// The same fields, each loop reading arrays of its own: times, endpoints, and a row state byte.
const T = 7;
const times = new Float64Array(N * T);
const endsA = new Float64Array(N * 2 * n);
const state = new Uint8Array(N);
const wts = new Float64Array(N);
const probedW = new Float64Array(N);
for (let p = 0; p < N; p++) {
  times[p * T + 0] = 0; // NOW
  times[p * T + 1] = 0; // ELAPSED
  times[p * T + 2] = 1; // RATE
  times[p * T + 3] = 0; // DELAY
  times[p * T + 4] = 0; // AT
  times[p * T + 5] = 10000; // MS
  times[p * T + 6] = 1; // W
  endsA[p * 6 + 3] = p * 0.37;
  endsA[p * 6 + 4] = 1;
  state[p] = 1;
}
function split(now) {
  const op = 'sum';
  for (let p = 0; p < N; p++) {
    if (state[p] !== 1) break;
    const t = p * T;
    const el = times[t + 1] + (now - times[t]) * times[t + 2] - times[t + 3];
    if (!(el >= 0)) break;
    const slot = list[p];
    if (per[slot * SLOT + 5] === fills - 1) probedW[p] = wts[p];
    const w = times[t + 6];
    wts[p] = w;
    if (w <= 0) continue;
    const share = left(eases[p], Math.max(0, el - times[t + 4]) / times[t + 5]);
    const base = slot * n;
    const e = p * 2 * n;
    for (let a = 0; a < n; a++)
      values[base + a] = fold(
        op,
        values[base + a],
        between(endsA[e + a], endsA[e + n + a], share),
        w,
      );
  }
}
function hand(now) {
  for (let p = 0; p < N; p++) {
    const t = p * T;
    const u = Math.min(1, Math.max(0, now - times[t]) / times[t + 5]);
    const s = 1 - smooth(u);
    const e = p * 6;
    for (let a = 0; a < 3; a++)
      out[p * 3 + a] = endsA[e + 3 + a] + (endsA[e + a] - endsA[e + 3 + a]) * s;
  }
}
function pullish() {
  for (let s = 0; s < N; s++) {
    const o = s * SLOT;
    if (per[o] >= 1e300 || per[o + 2] !== 0 || per[o + 1] < 0) break;
    per[o + 3] = fills;
    per[o + 5] = fills;
  }
  out.set(values);
}
function none() {}
function splitNoLeft(now) {
  for (let p = 0; p < N; p++) {
    if (state[p] !== 1) break;
    const t = p * T;
    const el = times[t + 1] + (now - times[t]) * times[t + 2] - times[t + 3];
    if (!(el >= 0)) break;
    const slot = list[p];
    const w = times[t + 6];
    wts[p] = w;
    if (w <= 0) continue;
    const u = Math.max(0, el - times[t + 4]) / times[t + 5];
    const share = u >= 1 ? 0 : 1 - smooth(u);
    const base = slot * n;
    const e = p * 2 * n;
    for (let a = 0; a < n; a++)
      values[base + a] = values[base + a] + between(endsA[e + a], endsA[e + n + a], share) * w;
  }
}
function splitLocal(now) {
  const op = 'sum';
  let lu = memo.u;
  let le = memo.ease;
  let ll = memo.left;
  for (let p = 0; p < N; p++) {
    if (state[p] !== 1) break;
    const t = p * T;
    const el = times[t + 1] + (now - times[t]) * times[t + 2] - times[t + 3];
    if (!(el >= 0)) break;
    const slot = list[p];
    if (per[slot * SLOT + 5] === fills - 1) probedW[p] = wts[p];
    const w = times[t + 6];
    wts[p] = w;
    if (w <= 0) continue;
    const u = Math.max(0, el - times[t + 4]) / times[t + 5];
    const ease = eases[p];
    if (u !== lu || ease !== le) {
      lu = u;
      le = ease;
      ll = u >= 1 ? 0 : 1 - ease(u);
    }
    const share = ll;
    const base = slot * n;
    const e = p * 2 * n;
    for (let a = 0; a < n; a++)
      values[base + a] = fold(
        op,
        values[base + a],
        between(endsA[e + a], endsA[e + n + a], share),
        w,
      );
  }
  memo.u = lu;
  memo.ease = le;
  memo.left = ll;
}
function curLocal(now) {
  const op = 'sum';
  let lu = memo.u;
  let le = memo.ease;
  let ll = memo.left;
  for (let p = 0; p < N; p++) {
    const h = p * HS;
    if (hot[h + 7] >= Infinity || (hot[h] & 0x7fb) !== WANT) break;
    const o = p * STRIDE;
    if (data[o + 4] < 0 || data[o + 7] === 0) break;
    const slot = list[p];
    const q = slot * SLOT;
    const el = hot[h + 2] + (now - hot[h + 1]) * hot[h + 3] - data[o];
    if (!(el >= 0)) break;
    if (per[q + 5] === fills - 1) data[o + 3] = data[o + 2];
    const w = hot[h + 4];
    data[o + 2] = w;
    if (data[o + 5] !== -2) data[o + 5] = -2;
    if (w <= 0) continue;
    const u = Math.max(0, el - hot[h + 8]) / hot[h + 9];
    const ease = eases[p];
    if (u !== lu || ease !== le) {
      lu = u;
      le = ease;
      ll = u >= 1 ? 0 : 1 - ease(u);
    }
    const share = ll;
    const base = slot * n;
    const x = h + 10;
    const g = x + 2 * n;
    for (let a = 0; a < n; a++)
      values[base + a] = fold(op, values[base + a], between(hot[x + a], hot[g + a], share), w);
  }
  memo.u = lu;
  memo.ease = le;
  memo.left = ll;
}

function mk(noId, noPer, noSampled, local, noBreaks, hs = HS, hotArr = hot) {
  return new Function(
    'hot',
    'data',
    'per',
    'values',
    'list',
    'eases',
    'memo',
    'left',
    'between',
    'fold',
    'N',
    'HS',
    'STRIDE',
    'SLOT',
    'n',
    'WANT',
    'getFills',
    `
  return function (now) {
    const fills = getFills();
    const op = 'sum';
    let lu = memo.u, le = memo.ease, ll = memo.left;
    for (let p = 0; p < N; p++) {
      const h = p * HS;
      ${noId ? '' : 'if (hot[h + 7] >= Infinity) break;'}
      if ((hot[h] & 0x7fb) !== WANT) break;
      const o = p * STRIDE;
      ${noBreaks ? '' : 'if (data[o + 4] < 0 || data[o + 7] === 0) break;'}
      const slot = list[p];
      const q = slot * SLOT;
      const el = hot[h + 2] + (now - hot[h + 1]) * hot[h + 3] - data[o];
      if (!(el >= 0)) break;
      ${noPer ? '' : 'if (per[q + 5] === fills - 1) data[o + 3] = data[o + 2];'}
      const w = hot[h + 4];
      data[o + 2] = w;
      ${noSampled ? '' : 'if (data[o + 5] !== -2) data[o + 5] = -2;'}
      if (w <= 0) continue;
      const u = Math.max(0, el - hot[h + 8]) / hot[h + 9];
      let share;
      ${
        local
          ? `const ease = eases[p];
      if (u !== lu || ease !== le) { lu = u; le = ease; ll = u >= 1 ? 0 : 1 - ease(u); }
      share = ll;`
          : 'share = left(eases[p], u);'
      }
      const base = slot * n;
      const x = h + 10;
      const g = x + (HS === 19 ? 2 * n : n);
      for (let a = 0; a < n; a++)
        values[base + a] = fold(op, values[base + a], between(hot[x + a], hot[g + a], share), w);
    }
    ${local ? 'memo.u = lu; memo.ease = le; memo.left = ll;' : ''}
  };`,
  )(
    hotArr,
    data,
    per,
    values,
    list,
    eases,
    memo,
    left,
    between,
    fold,
    N,
    hs,
    STRIDE,
    SLOT,
    n,
    WANT,
    () => fills,
  );
}
const hot14 = new Float64Array(N * 16);
for (let p = 0; p < N; p++) {
  for (let i = 0; i < 13; i++) hot14[p * 16 + i] = hot[p * HS + i];
  hot14[p * 16 + 13] = hot[p * HS + 16];
  hot14[p * 16 + 14] = hot[p * HS + 17];
  hot14[p * 16 + 15] = hot[p * HS + 18];
}
const abl = {
  d19: mk(1, 1, 0, 0, 0),
  d16: mk(1, 1, 0, 0, 0, 16, hot14),
  c1: mk(0, 0, 0, 0, 0),
  c2: mk(1, 0, 0, 0, 0),
  c3: mk(0, 1, 0, 0, 0),
  c4: mk(0, 0, 1, 0, 0),
  c5: mk(0, 0, 0, 1, 0),
  c6b: mk(0, 0, 0, 0, 1),
  c6: mk(1, 1, 1, 1, 1),
};
const variant = process.argv[2] ?? 'current';
const fn =
  abl[process.argv[2]] ??
  { current, split, hand, none, splitNoLeft, splitLocal, curLocal }[variant];
const bare = process.env.BARE === '1';
let t = 0;
const each = new Float64Array(FR);
for (let f = 0; f < FR + 300; f++) {
  const f0 = performance.now();
  t += 16.7;
  fills++;
  if (variant !== 'hand' && !bare) values.fill(0);
  fn(t);
  if (variant !== 'hand' && !bare) pullish();
  if (f >= 300) each[f - 300] = performance.now() - f0;
}
each.sort();
console.log(
  (variant + (bare ? ' bare' : '')).padEnd(18),
  (each[FR >> 1] * 1000).toFixed(1).padStart(7),
  'us p50',
);
