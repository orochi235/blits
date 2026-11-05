import { FLICKER_SEED } from '../../defects.js';
import { axesOf, CHANNELS } from '../../optics.js';
import { MIN_SHOWN } from '../optics-frame.js';
import { HASH_WGSL } from '../wgsl-hash.js';

/** Each channel's first number in a light's pose, ten numbers per light, as `output` holds them. */
export const SLOT = { lit: 0, gain: 1, tint: 2, hue: 6, chroma: 7, glow: 8, invert: 9 } as const;
export const POSE = 10;
const list = (xs: readonly number[]) =>
  `array<u32, ${xs.length}>(${xs.map((x) => `${x}u`).join(', ')})`;
/** Numbers per light in the optics' result: shine, r, g, b, bloom. */
export const SHOWS = 5;
export const GROUP = 64;

/**
 * Gathers each light's pose from the mix's buffer (`src`, by subject) or the uploaded columns
 * (`cpu`, by light, channel after channel), then lays a followed sign's planes over the dots and
 * swaps the highlighted dots' `invert`.
 */
export const GATHER_WGSL = `
struct Gather { n: u32, dots: u32, follow: u32, pad: u32, ch: array<vec4u, 7> }
@group(0) @binding(0) var<uniform> g: Gather;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read> cpu: array<f32>;
@group(0) @binding(3) var<storage, read> info: array<vec4u>;
@group(0) @binding(4) var<storage, read> followed: array<f32>;
@group(0) @binding(5) var<storage, read_write> pose: array<f32>;
const SLOTS = ${list(CHANNELS.map((c) => SLOT[c]))};
const AXES = ${list(CHANNELS.map(axesOf))};
@compute @workgroup_size(${GROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= g.n) { return; }
  let at = info[i];
  for (var c = 0u; c < 7u; c++) {
    let ch = g.ch[c];
    for (var a = 0u; a < AXES[c]; a++) {
      var v: f32;
      if (ch.x == 1u) { v = src[ch.y + at.x * ch.z + a]; } else { v = cpu[ch.y + i * ch.z + a]; }
      pose[i * ${POSE}u + SLOTS[c] + a] = v;
    }
  }
  if (i >= g.dots) { return; }
  if (g.follow != 0u) {
    for (var s = 0u; s < ${POSE}u; s++) {
      if ((g.follow & (1u << s)) != 0u) { pose[i * ${POSE}u + s] = followed[at.z * ${POSE}u + s]; }
    }
  }
  if (at.y != 0u) {
    let k = i * ${POSE}u + ${SLOT.invert}u;
    pose[k] = 1.0 - clamp(pose[k], 0.0, 1.0);
  }
}`;

/** OKLab, linear sRGB and sRGB bytes, as blits's `oklab.ts` converts them. */
const COLOR_WGSL = `
fn lab_linear(c: vec3f) -> vec3f {
  let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  let s_ = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return vec3f(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  );
}
fn cbrt(x: f32) -> f32 { return select(0.0, sign(x) * pow(abs(x), 1.0 / 3.0), x != 0.0); }
fn linear_lab(c: vec3f) -> vec3f {
  let l = cbrt(0.4122214708 * c.x + 0.5363325363 * c.y + 0.0514459929 * c.z);
  let m = cbrt(0.2119034982 * c.x + 0.6806995451 * c.y + 0.1073969566 * c.z);
  let s = cbrt(0.0883024619 * c.x + 0.2817188376 * c.y + 0.6299787005 * c.z);
  return vec3f(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
}
fn to_byte(v: f32) -> f32 {
  if (!(v > 0.0)) { return 0.0; }
  if (v >= 1.0) { return 255.0; }
  let e = select(1.055 * pow(v, 1.0 / 2.4) - 0.055, 12.92 * v, v <= 0.0031308);
  return floor(e * 255.0 + 0.5);
}
fn byte_linear(c: f32) -> f32 {
  let v = c / 255.0;
  return select(pow((v + 0.055) / 1.055, 2.4), v / 12.92, v <= 0.04045);
}
fn lab_bytes(lab: vec3f) -> vec3f {
  let c = lab_linear(lab);
  return vec3f(to_byte(c.x), to_byte(c.y), to_byte(c.z));
}
fn bytes_lab(b: vec3f) -> vec3f {
  return linear_lab(vec3f(byte_linear(b.x), byte_linear(b.y), byte_linear(b.z)));
}`;

/**
 * `createOpticsFrame`'s step, in three dispatches: `settle_main` (fault, then settle, per light),
 * `lines_main` (each row's and column's sum, for the ghosts) and `show_main` (ghost, shine and
 * `dotColor`, per light).
 */
export const OPTICS_WGSL = `${HASH_WGSL}
${COLOR_WGSL}
struct Optics {
  n: u32, dots: u32, cols: u32, rows: u32,
  dt: f32, brightness: f32, rise: f32, fall: f32,
  t_hi: f32, t_lo: f32, ghost_row: f32, ghost_col: f32,
  fallback_lab: vec4f,
  fallback_bytes: vec4f,
}
@group(0) @binding(0) var<uniform> o: Optics;
@group(0) @binding(1) var<storage, read> pose: array<f32>;
@group(0) @binding(2) var<storage, read> faults: array<vec4u>;
@group(0) @binding(3) var<storage, read_write> shown: array<f32>;
@group(0) @binding(4) var<storage, read_write> lines: array<f32>;
@group(0) @binding(5) var<storage, read_write> shows: array<f32>;

fn shown_lit(lit: f32, invert: f32) -> f32 {
  let on = min(max(lit, 0.0), 1.0);
  return on + min(max(invert, 0.0), 1.0) * (1.0 - 2.0 * on);
}

@compute @workgroup_size(${GROUP})
fn settle_main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= o.n) { return; }
  let f = faults[i];
  let want = shown_lit(pose[i * ${POSE}u + ${SLOT.lit}u], pose[i * ${POSE}u + ${SLOT.invert}u]);
  var v = want * bitcast<f32>(f.x);
  let rate = bitcast<f32>(f.z);
  if (rate > 0.0) {
    let k = i32(floor(o.t_hi * rate + o.t_lo * rate));
    if (bree_hash_u32(i32(i), k, ${FLICKER_SEED}) >= f.w) { v = 0.0; }
  }
  let goal = max(v, bitcast<f32>(f.y));
  let was = shown[i];
  let ms = select(o.fall, o.rise, goal > was);
  let k = select(1.0, 1.0 - exp(-o.dt / ms), ms > 0.0);
  shown[i] = was + (goal - was) * k;
}

@compute @workgroup_size(${GROUP})
fn lines_main(@builtin(global_invocation_id) id: vec3u) {
  let t = id.x;
  if (t < o.rows) {
    var sum = 0.0;
    for (var x = 0u; x < o.cols; x++) { sum += shown[t * o.cols + x]; }
    lines[t] = sum;
  } else if (t < o.rows + o.cols) {
    let x = t - o.rows;
    var sum = 0.0;
    for (var y = 0u; y < o.rows; y++) { sum += shown[y * o.cols + x]; }
    lines[t] = sum;
  }
}

/** \`dotColor\` in \`color.ts\`, as sRGB bytes. */
fn dot_color(tint: vec4f, hue: f32, chroma: f32) -> vec3f {
  let cover = tint.w;
  var src: vec3f;
  if (cover >= 1.0) {
    src = tint.xyz / cover;
  } else {
    var under = o.fallback_bytes.xyz;
    if (cover > 0.0) { under = lab_bytes(mix(o.fallback_lab.xyz, tint.xyz / cover, cover)); }
    if (hue == 0.0 && chroma == 1.0) { return under; }
    src = select(o.fallback_lab.xyz, bytes_lab(under), cover > 0.0);
  }
  let turn = hue * 0.017453292519943295;
  let c = cos(turn) * chroma;
  let s = sin(turn) * chroma;
  return lab_bytes(vec3f(src.x, src.y * c - src.z * s, src.y * s + src.z * c));
}

@compute @workgroup_size(${GROUP})
fn show_main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= o.n) { return; }
  let p = i * ${POSE}u;
  let v = shown[i];
  var leak = 0.0;
  if (i < o.dots && (o.ghost_row > 0.0 || o.ghost_col > 0.0)) {
    let y = i / o.cols;
    let x = i % o.cols;
    let across = select(0.0, (lines[y] - v) / f32(o.cols - 1u), o.cols > 1u);
    let down = select(0.0, (lines[o.rows + x] - v) / f32(o.rows - 1u), o.rows > 1u);
    leak = max(0.0, min(1.0, o.ghost_row * across + o.ghost_col * down) - v);
  }
  let now = v + leak * bitcast<f32>(faults[i].x);
  let q = i * ${SHOWS}u;
  shows[q + 4u] = pose[p + ${SLOT.glow}u];
  if (now < ${MIN_SHOWN}) {
    shows[q] = 0.0;
    return;
  }
  shows[q] = min(now * min(pose[p + ${SLOT.gain}u], 1.0) * o.brightness, 1.0);
  let t = p + ${SLOT.tint}u;
  let tint = vec4f(pose[t], pose[t + 1u], pose[t + 2u], pose[t + 3u]);
  let rgb = dot_color(tint, pose[p + ${SLOT.hue}u], pose[p + ${SLOT.chroma}u]) / 255.0;
  shows[q + 1u] = rgb.x;
  shows[q + 2u] = rgb.y;
  shows[q + 3u] = rgb.z;
}`;
