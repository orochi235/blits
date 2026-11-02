import { LINEAR_WGSL } from './channels.js';

/**
 * WGSL a host's shader includes to lay a color pose over a base as `toHex` does, in linear sRGB:
 * decode the base with `blits_decode`, lay the pose over it, and encode the result for an sRGB
 * target with `blits_encode`.
 *
 * - `blits_over_color(pose: vec4f, under: vec3f) -> vec3f` for `color()`, the pose `[Σw·L, Σw·a, Σw·b, Σw]`.
 * - `blits_over_free(pose: vec4f, under: vec3f) -> vec3f` for `multiply`, `screen`, `add`,
 *   `lighten`, and `darken`, the pose `[x, y, z, tag]`.
 * - `blits_lay(tag: f32, base: vec3f, layer: vec4f) -> vec3f` lays one layer `(r, g, b, α)` of an
 *   ordered mode's stack `[tag, n, r, g, b, α, …]` over `base`; lay layers `0..n` in order over the
 *   decoded base, then `clamp` to 0..1.
 *
 * @category gpu
 */
export const OVER_WGSL = `${LINEAR_WGSL}
fn blits_cbrt(x: f32) -> f32 { return sign(x) * pow(abs(x), 1.0 / 3.0); }
fn blits_lab(c: vec3f) -> vec3f {
  let l = blits_cbrt(0.4122214708 * c.x + 0.5363325363 * c.y + 0.0514459929 * c.z);
  let m = blits_cbrt(0.2119034982 * c.x + 0.6806995451 * c.y + 0.1073969566 * c.z);
  let s = blits_cbrt(0.0883024619 * c.x + 0.2817188376 * c.y + 0.6299787005 * c.z);
  return vec3f(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
}
fn blits_decode(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
fn blits_encode(c: vec3f) -> vec3f {
  let k = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(k, vec3f(1.0 / 2.4)) - 0.055, 12.92 * k, k <= vec3f(0.0031308));
}
fn blits_clip(c: vec3f) -> vec3f { return clamp(c, vec3f(0.0), vec3f(1.0)); }

fn blits_over_color(pose: vec4f, under: vec3f) -> vec3f {
  let w = pose.w;
  if (!(w > 0.0)) { return under; }
  let lab = pose.xyz / w;
  if (w >= 1.0) { return blits_clip(blits_linear(lab.x, lab.y, lab.z)); }
  let u = mix(blits_lab(under), lab, w);
  return blits_clip(blits_linear(u.x, u.y, u.z));
}

fn blits_over_free(pose: vec4f, under: vec3f) -> vec3f {
  let t = pose.w;
  let p = pose.xyz;
  if (t == -1.0) { return blits_clip(under * (vec3f(1.0) - p)); }
  if (t == -2.0) { return blits_clip(under + p - under * p); }
  if (t == -3.0) { return blits_clip(under + p); }
  if (t == -4.0) { return blits_clip(max(under, p)); }
  if (t == -5.0) { return blits_clip(min(under, vec3f(1.0) - p)); }
  return under;
}

fn blits_hard(b: f32, s: f32) -> f32 { return select(1.0 - 2.0 * (1.0 - b) * (1.0 - s), 2.0 * b * s, s <= 0.5); }
fn blits_soft(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return b - (1.0 - 2.0 * s) * b * (1.0 - b); }
  let d = select(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, b <= 0.25);
  return b + (2.0 * s - 1.0) * (d - b);
}
fn blits_dodge(b: f32, s: f32) -> f32 {
  if (b <= 0.0) { return 0.0; }
  if (s >= 1.0) { return 1.0; }
  return clamp(b / (1.0 - s), 0.0, 1.0);
}
fn blits_burn(b: f32, s: f32) -> f32 {
  if (b >= 1.0) { return 1.0; }
  if (s <= 0.0) { return 0.0; }
  return 1.0 - clamp((1.0 - b) / s, 0.0, 1.0);
}
fn blits_axis(t: f32, b: f32, s: f32) -> f32 {
  switch i32(-t) {
    case 6: { return blits_hard(s, b); }
    case 7: { return blits_soft(b, s); }
    case 8: { return blits_hard(b, s); }
    case 9: { return abs(b - s); }
    case 10: { return blits_dodge(b, s); }
    case 11: { return blits_burn(b, s); }
    case 12: { return b + s - 2.0 * b * s; }
    case 13: { return max(b - s, 0.0); }
    case 14: {
      if (b <= 0.0) { return 0.0; }
      if (s <= 0.0) { return 1.0; }
      return clamp(b / s, 0.0, 1.0);
    }
    case 15: { return clamp(b + s - 1.0, 0.0, 1.0); }
    case 16: { return select(blits_dodge(b, 2.0 * s - 1.0), blits_burn(b, 2.0 * s), s <= 0.5); }
    case 17: { return clamp(b + 2.0 * s - 1.0, 0.0, 1.0); }
    case 18: { return select(max(b, 2.0 * s - 1.0), min(b, 2.0 * s), s <= 0.5); }
    case 19: { return select(0.0, 1.0, b + s >= 1.0); }
    default: { return s; }
  }
}
fn blits_fits(c: vec3f) -> bool { return all(c >= vec3f(-1e-9)) && all(c <= vec3f(1.0 + 1e-9)); }
fn blits_put(L0: f32, A: f32, B: f32) -> vec3f {
  let l = clamp(L0, 0.0, 1.0);
  var rgb = blits_linear(l, A, B);
  if (!blits_fits(rgb)) {
    var lo = 0.0;
    var hi = 1.0;
    for (var i = 0; i < 20; i++) {
      let mid = (lo + hi) / 2.0;
      if (blits_fits(blits_linear(l, A * mid, B * mid))) { lo = mid; } else { hi = mid; }
    }
    rgb = blits_linear(l, A * lo, B * lo);
  }
  return blits_clip(rgb);
}
fn blits_hued(L: f32, hA: f32, hB: f32, cA: f32, cB: f32) -> vec3f {
  let h = length(vec2f(hA, hB));
  let c = length(vec2f(cA, cB));
  if (h < 1e-6 || c < 1e-6) { return blits_put(L, 0.0, 0.0); }
  return blits_put(L, hA * c / h, hB * c / h);
}
fn blits_whole(t: f32, base: vec3f, s: vec3f) -> vec3f {
  let b = blits_lab(base);
  let l = blits_lab(s);
  switch i32(-t) {
    case 20: { return blits_hued(b.x, l.y, l.z, b.y, b.z); }
    case 21: { return blits_hued(b.x, b.y, b.z, l.y, l.z); }
    case 22: { return blits_put(b.x, l.y, l.z); }
    case 23: { return blits_put(l.x, b.y, b.z); }
    case 24: { return select(base, s, l.x < b.x); }
    case 25: { return select(base, s, l.x > b.x); }
    default: { return s; }
  }
}
fn blits_lay(t: f32, base: vec3f, layer: vec4f) -> vec3f {
  let s = layer.xyz;
  var to: vec3f;
  if (t <= -20.0) {
    to = blits_whole(t, base, s);
  } else {
    to = vec3f(blits_axis(t, base.x, s.x), blits_axis(t, base.y, s.y), blits_axis(t, base.z, s.z));
  }
  return base + (to - base) * layer.w;
}
`;
