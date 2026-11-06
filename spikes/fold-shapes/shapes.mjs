// Node silhouettes from each rule's swept region, normalized: an edge never narrower than FLOOR of
// the node's height, a shift never more than SHIFT of it, and flat ends where ports and labels sit.
const W = 120, H = 56, G = 44, FLOOR = 0.5, SHIFT = 0.18, FLAT = 0.22, N = 5;
const rules = [
  ['sum', '+ 0.4', [-1, 1], (a) => a + 0.4],
  ['mul', '× 0.5', [0, 2], (a) => a * 0.5],
  ['mul', '× 2', [0, 2], (a) => a * 2],
  ['max', 'max 0.3', [0, 1], (a) => Math.max(a, 0.3)],
  ['min', 'min 0.6', [0, 1], (a) => Math.min(a, 0.6)],
  ['last', '= 0.7', [0, 1], () => 0.7],
  ['angle', '+ 0.3 turn', [0, 1], (a) => (a + 0.3) % 1],
];
const ease = (t) => (t <= FLAT ? 0 : t >= 1 - FLAT ? 1 : ((u) => u * u * (3 - 2 * u))((t - FLAT) / (1 - 2 * FLAT)));
const lerp = (a, b, t) => a + (b - a) * t;

// One rule's shape at weight w, as unit-square edges: [top, bottom] at the left end and the right.
function ends(lo, hi, f, name, w) {
  const xs = Array.from({ length: 65 }, (_, k) => lo + ((hi - lo) * k) / 64);
  let ys = xs.map(f);
  if (name === 'angle') ys = xs.map((a) => a + 0.3); // the wrap is detail, not outline
  const span = hi - lo;
  const outLo = Math.min(...ys), outHi = Math.max(...ys);
  const r = Math.max(outHi - outLo, 0) / span; // squeeze (<1) or stretch (>1)
  const shift = ((outLo + outHi) / 2 - (lo + hi) / 2) / span;
  // which side holds still: the edge whose extreme input maps to itself
  const left = r <= 1 ? 1 : FLOOR + (1 - FLOOR) / r;
  const right = r <= 1 ? FLOOR + (1 - FLOOR) * r : 1;
  const s = SHIFT * Math.tanh(shift / 0.25);
  let lc = 0.5, rc = 0.5 - s;
  // pin the side that does not move, so max and mul read as different
  const topFixed = Math.abs(f(hi) - hi) < 1e-9, botFixed = Math.abs(f(lo) - lo) < 1e-9;
  if (r < 1 && topFixed && !botFixed) rc = (0.5 - left / 2) + right / 2;
  if (r < 1 && botFixed && !topFixed) rc = (0.5 + left / 2) - right / 2;
  const L = [lc - left / 2, lc + left / 2], R = [rc - right / 2, rc + right / 2];
  return [L, [lerp(L[0], R[0], w), lerp(L[1], R[1], w)]];
}

function shape(x, y, lo, hi, f, name, w) {
  const [[lt, lb], [rt, rb]] = ends(lo, hi, f, name, w);
  const top = [], bot = [];
  for (let c = 0; c <= 32; c++) {
    const t = c / 32, e = ease(t);
    top.push([x + W * t, y + H * lerp(lt, rt, e)]);
    bot.push([x + W * t, y + H * lerp(lb, rb, e)]);
  }
  const pts = [...top, ...bot.reverse()].map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  // detail: a few lines in the input's order, eased between the ends; the angle's wrapped ones
  // leave through the top and come back from below.
  let d = '';
  for (let k = 1; k < N - 1 + 2; k++) {
    const u = k / (N + 1);
    const a = lo + (hi - lo) * u;
    const o = name === 'angle' ? a + 0.3 : f(a);
    const outLo = name === 'angle' ? lo + 0.3 : Math.min(f(lo), f(hi)), outHi = name === 'angle' ? hi + 0.3 : Math.max(f(lo), f(hi));
    const v = outHi > outLo ? (o - outLo) / (outHi - outLo) : 0.5;
    const yl = lerp(lb, lt, u), yr = lerp(rb, rt, v);
    const wrapped = false;
    let seg = '';
    for (let c = 0; c <= 32; c++) {
      const t = c / 32;
      const yy = lerp(yl, lerp(yl, yr, w), ease(t));
      seg += `${c ? 'L' : 'M'}${(x + W * t).toFixed(1)} ${(y + H * yy).toFixed(1)}`;
    }
    d += `<path d="${seg}" fill="none" stroke="${wrapped ? '#ff9a6a' : '#7fc8ff'}" stroke-opacity="${wrapped ? 0.6 : 0.28}" stroke-width="1"/>`;
  }
  return `<polygon points="${pts}" fill="#16222c" stroke="#3f9a52" stroke-width="2" stroke-linejoin="round"/>${d}`;
}

const rows = [1, 0.5, 0];
let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${80 + rules.length * (W + G) + G}" height="${rows.length * (H + 56) + 20}" font-family="Menlo,monospace" font-size="12"><rect width="100%" height="100%" fill="#0f151b"/>`;
rows.forEach((w, r) => {
  const y = 20 + r * (H + 56);
  s += `<text x="12" y="${y + H / 2 + 4}" fill="#6f8496" font-size="10">weight ${w}</text>`;
  rules.forEach(([name, desc, [lo, hi], f], i) => {
    const x = 80 + G + i * (W + G);
    s += shape(x, y, lo, hi, f, name, w);
    s += `<text x="${x + W * 0.5}" y="${y + H / 2 + 4}" fill="#dbe7f2" text-anchor="middle">${name}</text>`;
    if (r === 0) s += `<text x="${x + W / 2}" y="${y + H + 18}" fill="#6f8496" text-anchor="middle" font-size="10">${desc}</text>`;
  });
});
console.log(s + '</svg>');
