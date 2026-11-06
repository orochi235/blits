// 128 px stamps for the fold rules: the output against what the fold holds so far, one translucent curve
// per voice value, overlaid. The merges mirror blits' (src/channels.ts, src/extremes.ts) at weight 1.
import { writeFileSync } from 'node:fs';

const S = 128, PAD = 10, CURVES = 28, STEPS = 96;
const RULES = [
  ['sum', [-1, 1], [-2, 2], (a, v) => a + v],
  ['mul', [0, 2], [0, 4], (a, v) => a * v],
  ['max', [0, 1], [0, 1], (a, v) => Math.max(a, v)],
  ['min', [0, 1], [0, 1], (a, v) => Math.min(a, v)],
  ['norm', [0, 1], [0, 1.5], (a, v) => Math.hypot(a, v)],
  ['last', [0, 1], [0, 1], (_a, v) => v],
  ['angle', [0, 1], [0, 1], (a, v) => (a + v) % 1],
];

function stamp([, [lo, hi], [ylo, yhi], f], color) {
  const X = (a) => PAD + ((a - lo) / (hi - lo)) * (S - 2 * PAD);
  const Y = (o) => S - PAD - ((o - ylo) / (yhi - ylo)) * (S - 2 * PAD);
  let out = '';
  for (let k = 0; k < CURVES; k++) {
    const v = lo + ((hi - lo) * (k + 0.5)) / CURVES;
    let d = '', prev = null;
    for (let i = 0; i <= STEPS; i++) {
      const a = lo + ((hi - lo) * i) / STEPS;
      const o = f(a, v);
      // a wrap is a jump, not a stroke across the stamp
      const jump = prev !== null && Math.abs(o - prev) > (yhi - ylo) / 2;
      d += `${d === '' || jump ? 'M' : 'L'}${X(a).toFixed(1)} ${Y(o).toFixed(1)}`;
      prev = o;
    }
    out += `<path d="${d}" stroke="${color(k / (CURVES - 1))}"/>`;
  }
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" fill="none" stroke-width="1.5" stroke-opacity="0.22" stroke-linecap="round" stroke-linejoin="round"><clipPath id="c"><rect width="${S}" height="${S}" rx="10"/></clipPath><g clip-path="url(#c)">${out}</g></svg>`;
}

const SCHEMES = [
  ['one ink', () => '#7fc8ff'],
  ['voice value as hue', (t) => `hsl(${200 + t * 120} 80% 66%)`],
];

let body = '';
for (const [name, color] of SCHEMES) {
  body += `<h2>${name}</h2><div class="row">`;
  for (const r of RULES) body += `<figure>${stamp(r, color)}<figcaption>${r[0]}</figcaption></figure>`;
  body += `</div>`;
}

writeFileSync(
  new URL('./stamps.html', import.meta.url),
  `<!doctype html><meta charset="utf-8"><title>fold rule stamps</title><style>
body{margin:0;padding:12px 20px;background:#0f151b;color:#dbe7f2;font:12px Menlo,monospace}
h2{font-size:12px;color:#7ba7c7;margin:8px 0}
.row{display:flex;gap:14px}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px}
svg{background:#16222c;border-radius:10px}
figcaption{color:#6f8496}
</style>${body}`,
);
