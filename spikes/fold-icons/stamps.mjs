// 128 px stamps for the fold rules: the output against what the fold holds so far, one translucent curve
// per voice value, overlaid. The merges mirror blits' (src/channels.ts, src/extremes.ts) at weight 1.
import { writeFileSync } from 'node:fs';

const S = 128, PAD = 10, STEPS = 96;
const RULES = [
  ['sum', [-1, 1], [-2, 2], (a, v) => a + v],
  ['mul', [0, 2], [0, 4], (a, v) => a * v],
  ['max', [0, 1], [0, 1], (a, v) => Math.max(a, v)],
  ['min', [0, 1], [0, 1], (a, v) => Math.min(a, v)],
  ['norm', [0, 1], [0, 1.5], (a, v) => Math.hypot(a, v)],
  ['last', [0, 1], [0, 1], (_a, v) => v],
  ['angle', [0, 1], [0, 1], (a, v) => (a + v) % 1],
];

let ids = 0;
function stamp([, [lo, hi], [ylo, yhi], f], look) {
  const { curves, ink, opacity, width, blend, glow, bg } = look;
  const id = `s${ids++}`;
  const X = (a) => PAD + ((a - lo) / (hi - lo)) * (S - 2 * PAD);
  const Y = (o) => S - PAD - ((o - ylo) / (yhi - ylo)) * (S - 2 * PAD);
  let out = '';
  for (let k = 0; k < curves; k++) {
    const v = lo + ((hi - lo) * (k + 0.5)) / curves;
    let d = '', prev = null;
    for (let i = 0; i <= STEPS; i++) {
      const a = lo + ((hi - lo) * i) / STEPS;
      const o = f(a, v);
      // a wrap is a jump, not a stroke across the stamp
      const jump = prev !== null && Math.abs(o - prev) > (yhi - ylo) / 2;
      d += `${d === '' || jump ? 'M' : 'L'}${X(a).toFixed(1)} ${Y(o).toFixed(1)}`;
      prev = o;
    }
    const t = curves > 1 ? k / (curves - 1) : 0.5;
    const inkOf = typeof ink === "function" ? ink(t) : ink;
    const opOf = typeof opacity === "function" ? opacity(t) : opacity;
    out += `<path d="${d}" stroke="${inkOf}" stroke-opacity="${opOf}"/>`;
  }
  const lines = `<g stroke-width="${width}"${blend ? ' style="mix-blend-mode:plus-lighter"' : ''}>${out}</g>`;
  const halo = glow
    ? `<filter id="${id}g" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${glow}"/></filter><g filter="url(#${id}g)" opacity="0.9">${lines}</g>`
    : '';
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" fill="none" stroke-linecap="round" stroke-linejoin="round"><clipPath id="${id}"><rect width="${S}" height="${S}" rx="10"/></clipPath><g clip-path="url(#${id})"><rect width="${S}" height="${S}" fill="${bg}"/><g style="isolation:isolate">${halo}${lines}</g></g></svg>`;
}

const BASE = { curves: 28, ink: '#7fc8ff', opacity: 0.22, width: 1.5, blend: false, glow: 0, bg: '#16222c' };
const HOT = { ...BASE, curves: 22, ink: '#7ad0ff', opacity: 0.6, width: 1.75, blend: true, glow: 1.4, bg: '#070c10' };
const LOOKS = [
  ['hot', HOT],
  ['hot, hue by voice value (blue to magenta)', { ...HOT, ink: (t) => `hsl(${205 + t * 115} 95% 66%)` }],
  ['hot, hue by voice value (cyan to amber)', { ...HOT, ink: (t) => `hsl(${190 - t * 155} 95% 62%)` }],
  ['hot, opacity by voice value', { ...HOT, opacity: (t) => 0.12 + t * 0.78 }],
  ['hot, hue and opacity', { ...HOT, ink: (t) => `hsl(${205 + t * 115} 95% 66%)`, opacity: (t) => 0.15 + t * 0.75 }],
];

let body = '';
for (const [name, look] of LOOKS) {
  body += `<h2>${name}</h2><div class="row">`;
  for (const r of RULES) body += `<figure>${stamp(r, look)}<figcaption>${r[0]}</figcaption></figure>`;
  body += `</div>`;
}

writeFileSync(
  new URL('./stamps.html', import.meta.url),
  `<!doctype html><meta charset="utf-8"><title>fold rule stamps</title><style>
body{margin:0;padding:12px 20px;background:#0f151b;color:#dbe7f2;font:12px Menlo,monospace}
h2{font-size:12px;color:#7ba7c7;margin:8px 0}
.row{display:flex;gap:14px}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px}
svg{border-radius:10px}
figcaption{color:#6f8496}
</style>${body}`,
);
