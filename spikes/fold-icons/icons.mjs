// Candidate glyphs for the fold rules, in weasel's ui register: a 20-unit box shown at 16 px, a 1.5
// stroke with round caps and joins, straight lines on pixel centers (`px`). Writes sheet.html.
import { writeFileSync } from 'node:fs';

const px = (k) => 0.625 + 1.25 * k;
const n = (v) => Math.round(v * 100) / 100;
const R = (d) => (d * Math.PI) / 180;
const chevron = (tip, dir, L = 2.5 * Math.SQRT2, spread = 45) => {
  const m = Math.hypot(dir[0], dir[1]);
  const b = [-dir[0] / m, -dir[1] / m];
  const rot = (a) => [b[0] * Math.cos(R(a)) - b[1] * Math.sin(R(a)), b[0] * Math.sin(R(a)) + b[1] * Math.cos(R(a))];
  const p = (v) => `${n(tip[0] + L * v[0])} ${n(tip[1] + L * v[1])}`;
  return `M${p(rot(spread))} ${n(tip[0])} ${n(tip[1])} ${p(rot(-spread))}`;
};
const path = (d, extra = '') => `<path d="${d}"${extra}/>`;
const dot = (x, y, r = 1.4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const circle = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const rect = (x, y, w, h, rx = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
const thin = ' stroke-width="1"';
const [A, B, C, D, E, F, G, H, I, J, K, L, M, N] = Array.from({ length: 14 }, (_, k) => n(px(k)));
// A..N are pixel centers 0..13: C 3.13, D 4.38, E 5.63, F 6.88, G 8.13, H 9.38, I 10.63, J 11.88,
// K 13.13, L 14.38, M 15.63, N 16.88.

const onCircle = (cx, cy, r, deg) => [n(cx + r * Math.cos(R(deg))), n(cy - r * Math.sin(R(deg)))];
const ccwTangent = (deg) => [-Math.sin(R(deg)), -Math.cos(R(deg))];
/** A clock face whose rim runs counterclockwise from `from` the long way to `to`, an arrowhead at `to`, and
 *  hands from the center to each of `hands` (math angles). `gap` leaves the rim open short of the head. */
function history({ r = 6.4, from, to, hands, head = 2.6, spread = 40, dot: hub = false }) {
  const [x0, y0] = onCircle(10, 10, r, from);
  const [x1, y1] = onCircle(10, 10, r, to);
  const sweep = (((to - from) % 360) + 360) % 360;
  const arc = `M${x0} ${y0}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 0 ${x1} ${y1}`;
  const handPaths = hands.map(([deg, len]) => {
    const [hx, hy] = onCircle(10, 10, len, deg);
    return `M10 10L${hx} ${hy}`;
  });
  return path(arc) + path(chevron([x1, y1], ccwTangent(to), head, spread)) + path(handPaths.join('')) + (hub ? dot(10, 10, 1) : '');
}

const GLYPHS = {
  'norm (calipers)': {
    vernier: path(`M3.6 4.4H16.4M5 4.4V13.6L7.2 11.6V4.4M15 4.4V13.6L12.8 11.6V4.4`),
    'vernier on a dot': path(`M3.6 4.4H16.4M5.6 4.4V12.4L7.6 10.4V4.4M14.4 4.4V12.4L12.4 10.4V4.4`) + circle(10, 13.6, 2.4),
    dividers: path(`M10 3.4L4.6 16.4M10 3.4L15.4 16.4M7.4 9.8H12.6`) + dot(10, 3.4, 1.2),
    'dividers on a hypotenuse': path(`M3.6 16.4H16.4V3.6`, thin) + path(`M3.6 16.4L16.4 3.6`, ' stroke-dasharray="1.25 1.9" stroke-width="1"') + path(`M3.6 16.4L6.4 6.4L16.4 3.6`) + dot(6.4, 6.4, 1.2),
    'outside calipers': path(`M10 3.4C4 5 3.2 12 6.4 16M10 3.4C16 5 16.8 12 13.6 16`) + dot(10, 3.4, 1.2) + path(`M6.4 16H13.6`, thin),
    'jaws on two legs': path(`M3.6 3.6H13.6M3.6 3.6V8M13.6 3.6V8`) + path(`M3.6 16.4H16.4V8.4`, thin) + path(`M3.6 8L16.4 8.4`, ' stroke-dasharray="1.25 1.9" stroke-width="1"'),
  },
  'last (history)': {
    'head at 9': history({ from: 220, to: 180, hands: [[90, 3.6], [-30, 2.6]] }),
    'head at 10': history({ from: 190, to: 150, hands: [[90, 3.6], [0, 2.8]] }),
    'head at 8': history({ from: 250, to: 210, hands: [[90, 3.6], [-30, 2.6]] }),
    'wide gap': history({ from: 240, to: 160, hands: [[90, 3.4], [0, 2.6]] }),
    'tight, one hand': history({ from: 195, to: 165, hands: [[60, 3.6]], hub: true }),
    'hands 12 + 9': history({ from: 250, to: 210, hands: [[90, 3.6], [180, 2.6]] }),
    'tail out': path(`M3.4 10A6.6 6.6 0 1 0 5.2 5.4`) + path(chevron([5.2, 5.4], [-0.75, 0.66], 2.6, 40)) + path(`M3.4 10H1.8`) + path(`M10 6.4V10L12.6 11.6`),
  },
  sum: {
    plus: path(`M10 4.9v10.2M4.9 10h10.2`),
    'plus in circle': circle(10, 10, 6.6) + path(`M10 6.6v6.8M6.6 10h6.8`),
    'end to end': path(`M${C} ${E}H${H}M${H} ${H}H${N}M${C} ${L}H${N}`) + path(`M${C} ${D}v2.5M${H} ${D}v2.5`, thin),
    'stacked blocks': rect(5.6, 3.6, 8.8, 4.6) + rect(5.6, 8.2, 8.8, 8.2),
    'tip to tail': path(`M3.6 15.6L8.8 8.4`) + path(chevron([8.8, 8.4], [5.2, -7.2], 2.6, 40)) + path(`M9.8 8.4H16`) + path(chevron([16, 8.4], [1, 0], 2.6, 40)),
    'shifted line': path(`M3.6 16.4L16.4 3.6`) + path(`M3.6 11L11 3.6`, thin) + path(`M13.6 12.4v-4`) + path(chevron([13.6, 8.4], [0, -1], 2.2, 45)),
    sigma: path(`M15 4.4H5.4L10.4 10L5.4 15.6H15`),
  },
  mul: {
    times: path(`M5.6 5.6l8.8 8.8M14.4 5.6l-8.8 8.8`),
    'times in circle': circle(10, 10, 6.6) + path(`M7.3 7.3l5.4 5.4M12.7 7.3l-5.4 5.4`),
    'area': path(`M${C} ${D}V${N}H${M}`) + rect(C, 9.4, 7.5, 7.5, 0) + path(`M${C} 9.4H${K}V${N}`, thin),
    'nested corners': rect(3.6, 3.6, 12.8, 12.8) + rect(3.6, 9.6, 6.8, 6.8),
    fan: path(`M3.6 16.4L16.4 3.6M3.6 16.4L16.4 9.6M3.6 16.4H16.4`),
    'scaled arrow': path(`M3.6 16.4L9 11`) + path(`M3.6 16.4L15.6 4.4`, thin) + path(chevron([15.6, 4.4], [1, -1], 2.8, 40)),
    'grow from corner': path(`M3.6 16.4V3.6M3.6 16.4H16.4`) + path(`M3.6 10H10V16.4`, thin) + path(`M3.6 5.6H14.4V16.4`),
  },
  max: {
    vee: path(`M4.4 5.6L10 15L15.6 5.6`),
    'floor then rise': path(`M3.6 ${K}H9.4L16.4 4`),
    'taller bar capped': path(`M${F} ${N}V9.4M${K} ${N}V${D}`) + path(`M${C} ${D}H${N}`, thin),
    'upper envelope': path(`M3.6 14.4L16.4 5.6`, thin) + path(`M3.6 5.6L16.4 14.4`, thin) + path(`M3.6 5.6L10 10L16.4 5.6`),
    'caret under ceiling': path(`M4.4 14L10 8L15.6 14`) + path(`M4.4 4.4H15.6`),
    'two peaks': path(`M3 16L7 10L10 13L14 5L17 16`) + dot(14, 2.4, 1.1),
  },
  min: {
    wedge: path(`M4.4 14.4L10 5L15.6 14.4`),
    'rise then ceiling': path(`M3.6 16L10.6 ${G}H16.4`),
    'shorter bar capped': path(`M${F} ${N}V9.4M${K} ${N}V${D}`) + path(`M${C} 9.4H${N}`, thin),
    'lower envelope': path(`M3.6 14.4L16.4 5.6`, thin) + path(`M3.6 5.6L16.4 14.4`, thin) + path(`M3.6 14.4L10 10L16.4 14.4`),
    'caret over floor': path(`M4.4 6L10 12L15.6 6`) + path(`M4.4 15.6H15.6`),
    'two valleys': path(`M3 4L7 10L10 7L14 15L17 4`) + dot(14, 17.6, 1.1),
  },
  norm: {
    hypotenuse: path(`M${D} ${D}V${M}H${M}`, thin) + path(`M${D} ${D}L${M} ${M}`),
    'hypotenuse arrow': path(`M${D} ${M}H${L}M${D} ${M}V${E}`, thin) + path(`M${D} ${M}L${L} ${E}`) + path(chevron([L, E], [1, -1], 2.8, 40)),
    radical: path(`M3.2 10.4L5.4 9.4L8.4 16L12 3.8H16.8`),
    'double bars': path(`M${D} ${D}V${M}M${F} ${D}V${M}M${K} ${D}V${M}M${M} ${D}V${M}`) + dot(10, 10, 1.3),
    'smooth corner': path(`M3.6 ${K}H6.4C9.6 ${K} 10.4 12 16.4 4`),
    'quarter circle': path(`M${D} ${D}V${M}H${M}`, thin) + path(`M${D} 4.6A11 11 0 0 1 15.4 ${M}`),
  },
  last: {
    'front card': path(`M5.2 3.6H14M3.6 6H15.6`, thin) + rect(3.6, 8.4, 12.8, 8, 1.2),
    'to the end': path(`M3.6 10H13`) + path(chevron([13.4, 10], [1, 0])) + path(`M${M} 4.4V15.6`),
    'flat line': path(`M3.6 14L8 6`, thin) + path(`M8 10H16.4`) + dot(16.4, 10, 1.6),
    'last of three': dot(4.4, 10, 1.3) + dot(8.6, 10, 1.3) + circle(14.2, 10, 2.6),
    'playhead': path(`M3.6 13.6L9 8.4L12.4 11.6`, thin) + path(`M${L} 3.6V16.4`) + dot(L, 11.6, 1.6),
    'overwrite': rect(3.6, 3.6, 9, 9, 1) + path(`M7.4 7.4H16.4V16.4H7.4Z`) + path(`M9.4 12.4l2 2 3.4-4.4`, thin),
  },
  angle: {
    'angle mark': path(`M15.6 ${M}H${D}L13 4.4`) + path(`M10 ${M}A5.6 5.6 0 0 0 8.4 11.4`),
    'sector': circle(10, 10, 6.8) + path(`M10 10V3.2M10 10L15.9 13.4`),
    'turn arrow': path(`M14.8 6A6.4 6.4 0 1 0 16.4 10.4`) + path(chevron([14.8, 6], [-0.6, -0.8], 2.6, 40)),
    'wraps round': path(`M3.6 15.6L10 4.4V15.6L16.4 4.4`),
    'hands add': circle(10, 10, 6.8) + path(`M10 10L10 5.2M10 10L13.4 12.8`) + path(`M10 3.2A6.8 6.8 0 0 1 16.4 12.4`, thin),
    'dial': circle(10, 10, 6.6) + path(`M10 10L14.2 5.8`) + dot(10, 10, 1.1),
  },
  replace: {
    'front swatch': path(`M3.6 12.4V4.8A1.2 1.2 0 0 1 4.8 3.6H11.2A1.2 1.2 0 0 1 12.4 4.8V7.6`) + rect(7.6, 7.6, 8.8, 8.8, 1.2),
    'arrow into swatch': path(`M3.6 10H8.6`) + path(chevron([8.6, 10], [1, 0], 2.6, 40)) + rect(10.4, 4.4, 6, 11.2, 1.2),
    'swap': path(`M4.4 7.6H14.4`) + path(chevron([14.4, 7.6], [1, 0], 2.6, 40)) + path(`M15.6 12.4H5.6`, thin) + path(chevron([5.6, 12.4], [-1, 0], 2.2, 45), thin),
    'covered circle': path(`M8 4.4A5.6 5.6 0 0 0 8 15.6`, thin) + circle(12, 10, 5.6),
    'stamp': rect(4.4, 11.6, 11.2, 4.8, 1) + path(`M10 3.6V8.8`) + path(chevron([10, 8.8], [0, 1], 2.6, 40)),
  },
  average: {
    'overlap lens': circle(7.6, 10, 5) + circle(12.4, 10, 5),
    'midpoint': circle(4.6, 10, 1.6) + circle(15.4, 10, 1.6) + path(`M6.2 10H13.8`, thin) + dot(10, 10, 1.6),
    'mean line': path(`M${F} ${N}V${F}M${K} ${N}V${L}`) + path(`M${C} ${J}H${N}`, thin) + path(`M${C} ${J}H${N}`, ' stroke-dasharray="1.25 1.25"'),
    'balance': path(`M3.6 8.4H16.4M10 8.4L7.4 15.6H12.6Z`) + dot(4.8, 6.4, 1.3) + dot(15.2, 6.4, 1.3),
    'x bar': path(`M5.6 4.4H14.4`) + path(`M6.4 8.4L13.6 16M13.6 8.4L6.4 16`),
    'gradient': rect(3.6, 6.4, 12.8, 7.2, 1.2) + path(`M7.8 6.4V13.6M12.2 6.4V13.6`, thin),
  },
};

const ATTRS =
  'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const svg = (body, size) => `<svg viewBox="0 0 20 20" width="${size}" height="${size}" ${ATTRS}>${body}</svg>`;

let rows = '';
for (const [op, stabs] of Object.entries(GLYPHS)) {
  rows += `<section><h2>${op}</h2><div class="stabs">`;
  for (const [name, body] of Object.entries(stabs)) {
    rows += `<figure><div class="big">${svg(body, 56)}</div><div class="real">${svg(body, 16)}${svg(body, 16)}</div><figcaption>${name}</figcaption></figure>`;
  }
  rows += `</div></section>`;
}

writeFileSync(
  new URL('./sheet.html', import.meta.url),
  `<!doctype html><meta charset="utf-8"><title>fold rule glyphs</title><style>
body{margin:0;padding:16px 20px;background:#0f151b;color:#dbe7f2;font:12px Menlo,monospace}
section{display:flex;align-items:center;gap:12px;margin:0 0 8px}
h2{width:72px;margin:0;font-size:13px;color:#7ba7c7}
.stabs{display:flex;gap:10px}
figure{margin:0;width:96px;display:flex;flex-direction:column;align-items:center;gap:4px}
.big{background:#16222c;border-radius:6px;padding:4px;line-height:0}
.real{display:flex;gap:6px;line-height:0}.real svg:last-child{color:#16222c;background:#dbe7f2;border-radius:2px}
figcaption{color:#6f8496;font-size:10px;text-align:center}
</style>${rows}`,
);
