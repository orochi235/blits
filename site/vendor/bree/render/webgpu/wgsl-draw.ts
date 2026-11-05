import { TAPS } from '../blur.js';
import { NO_LIGHT, SOCKET } from '../prims.js';
import { SHOWS } from './wgsl-optics.js';
import { SDF_WGSL } from './wgsl-sdf.js';

/** Floats in the draw's uniform `U`. */
export const LOOK_FLOATS = 40;

/**
 * The WebGL sign's shaders (`webgl/glsl.ts`) in WGSL: each primitive one instance of a quad,
 * reading its view from `views` and what its light shows from the optics' `shows`.
 */
const INSTANCE = `
struct U {
  canvas: vec2f, lamp: f32, glow: f32,
  core: f32, core_alpha: f32, wire: f32, blurred: f32,
  spread: f32, pad0: f32, pad1: f32, pad2: f32,
  core_tint: vec4f,
  sockets: array<vec4f, 6>,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> geom: array<vec4f>;
@group(0) @binding(2) var<storage, read> shows: array<f32>;
@group(0) @binding(3) var<storage, read> info: array<vec4u>;
@group(0) @binding(4) var<storage, read> views: array<vec4f>;
@group(0) @binding(5) var<storage, read> points: array<vec2f>;
${SDF_WGSL}
struct V {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) kind: u32,
  @location(2) @interpolate(flat) g0: vec4f,
  @location(3) @interpolate(flat) g1: vec4f,
  @location(4) @interpolate(flat) r: f32,
  @location(5) @interpolate(flat) px: f32,
  @location(6) @interpolate(flat) clip: vec4f,
  @location(7) @interpolate(flat) socket: u32,
  @location(8) @interpolate(flat) shine: f32,
  @location(9) @interpolate(flat) rgb: vec3f,
  @location(10) @interpolate(flat) sigma: f32,
  @location(11) @interpolate(flat) peak: f32,
}
const NOWHERE = vec4f(2.0, 2.0, 2.0, 1.0);
fn prim(i: u32) -> V {
  var v: V;
  let m = info[i];
  v.kind = m.x;
  v.socket = m.w;
  v.g0 = geom[i * 2u];
  v.g1 = geom[i * 2u + 1u];
  v.r = prim_radius(v.kind, v.g0, v.g1, u.lamp);
  return v;
}
fn owned(i: u32) -> bool { return info[i].y != ${NO_LIGHT}u; }
fn light(i: u32) -> u32 { return info[i].y; }
fn view_of(i: u32) -> vec4f { return views[info[i].z * 2u]; }
/** Places a quad over the primitive's box grown by \`grow\` device px, through its view. */
fn place(v: ptr<function, V>, i: u32, k: u32, grow: f32) {
  let va = view_of(i);
  (*v).clip = views[info[i].z * 2u + 1u];
  (*v).px = va.z;
  if (!(va.z > 0.0)) { (*v).pos = NOWHERE; return; }
  let box = prim_box((*v).kind, (*v).g0, (*v).g1, (*v).r);
  let g = grow / va.z;
  let corner = vec2f(select(0.0, 1.0, (k & 1u) == 1u), select(0.0, 1.0, k >= 2u));
  let local = mix(box.xy - g, box.zw + g, corner);
  (*v).local = local;
  let p = vec2f(va.x + (local.x - local.y * va.w) * va.z, va.y + local.y * va.z);
  (*v).pos = vec4f(p.x / u.canvas.x * 2.0 - 1.0, 1.0 - p.y / u.canvas.y * 2.0, 0.0, 1.0);
}
/** The fragment's distance in device px; false where it falls outside its view's clip. */
fn dist(v: V) -> f32 {
  return prim_dist(v.kind, v.g0, v.g1, v.local, v.r) * v.px;
}
fn clipped(v: V) -> bool {
  let at = v.pos.xy;
  return at.x < v.clip.x || at.y < v.clip.y || at.x > v.clip.z || at.y > v.clip.w;
}
fn lit(i: u32) -> vec4f {
  let q = light(i) * ${SHOWS}u;
  return vec4f(shows[q], shows[q + 1u], shows[q + 2u], shows[q + 3u]);
}
`;

/** A primitive's socket or faceplate, drawn into the housing whenever the views change. */
export const HOUSING_WGSL = `${INSTANCE}
@vertex fn vs(@builtin(vertex_index) k: u32, @builtin(instance_index) i: u32) -> V {
  var v = prim(i);
  if (v.socket == ${SOCKET.none}u) { v.pos = NOWHERE; return v; }
  if (v.socket == ${SOCKET.wire}u) { v.r = max(v.r * u.wire, 0.5 / max(view_of(i).z, 1e-6)); }
  place(&v, i, k, 1.0);
  return v;
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  if (clipped(v)) { discard; }
  let cover = 1.0 - smoothstep(-0.5, 0.5, dist(v));
  return vec4f(u.sockets[v.socket].rgb, 1.0) * cover;
}`;

/** A primitive's glow before the blur, as `GLOW_VS` and `GLOW_FS` paint it. */
export const GLOW_WGSL = `${INSTANCE}
@vertex fn vs(@builtin(vertex_index) k: u32, @builtin(instance_index) i: u32) -> V {
  var v = prim(i);
  if (!owned(i)) { v.pos = NOWHERE; return v; }
  let s = lit(i);
  let bloom = shows[light(i) * ${SHOWS}u + 4u];
  let px = view_of(i).z;
  let wide = max(bloom * u.glow * prim_glow(v.kind, v.g0, v.g1), 0.0);
  let halo = v.r * px * wide;
  let sigma = max(halo * 0.5, 0.7);
  let blur = select(px * u.spread * wide, 0.0, u.blurred > 0.5);
  v.sigma = sqrt(sigma * sigma + blur * blur);
  v.peak = halo * halo / (2.0 * v.sigma * v.sigma);
  v.shine = s.x;
  v.rgb = s.yzw;
  if (!(s.x > 0.0 && halo > 0.0)) { v.pos = NOWHERE; return v; }
  place(&v, i, k, v.sigma * 3.0);
  return v;
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  if (clipped(v)) { discard; }
  let d = max(dist(v) + v.r * v.px, 0.0);
  let g = v.peak * exp(-(d * d) / (2.0 * v.sigma * v.sigma)) * v.shine;
  return vec4f(v.rgb * g, g);
}`;

/** A primitive's lens: its light's color over its shape, a pale core down its middle. */
export const BODY_WGSL = `${INSTANCE}
@vertex fn vs(@builtin(vertex_index) k: u32, @builtin(instance_index) i: u32) -> V {
  var v = prim(i);
  if (!owned(i)) { v.pos = NOWHERE; return v; }
  let s = lit(i);
  v.shine = s.x;
  v.rgb = s.yzw;
  if (!(s.x > 0.0)) { v.pos = NOWHERE; return v; }
  place(&v, i, k, 1.0);
  return v;
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  if (clipped(v)) { discard; }
  let d = dist(v);
  let r = v.r * v.px;
  let body = v.shine * (1.0 - smoothstep(-0.5, 0.5, d));
  let rc = r * u.core;
  let soft = max(0.5, rc * 0.25);
  let core = v.shine * u.core_alpha * (1.0 - smoothstep(-soft, soft, d + r - rc));
  return vec4f(u.core_tint.rgb * core + v.rgb * body * (1.0 - core), core + body * (1.0 - core));
}`;

const FULL = `
@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;
struct F { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) k: u32) -> F {
  let p = vec2f(select(-1.0, 3.0, k == 1u), select(-1.0, 3.0, k == 2u));
  return F(vec4f(p, 0.0, 1.0), vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5));
}`;

/** One axis of a Gaussian blur, its weights summing to 1; past the edge is dark, as in 2D. */
export const BLUR_WGSL = `${FULL}
struct B { step: vec2f, pad: vec2f, weight: array<vec4f, ${Math.ceil((TAPS + 1) / 4)}> }
@group(0) @binding(2) var<uniform> b: B;
fn tap(uv: vec2f) -> vec4f {
  let inside = step(vec2f(0.0), uv) * step(uv, vec2f(1.0));
  return textureSampleLevel(src, smp, uv, 0.0) * inside.x * inside.y;
}
fn weight(i: u32) -> f32 { return b.weight[i / 4u][i % 4u]; }
@fragment fn fs(f: F) -> @location(0) vec4f {
  var sum = tap(f.uv) * weight(0u);
  for (var i = 1u; i <= ${TAPS}u; i++) {
    let off = b.step * f32(i);
    sum += (tap(f.uv + off) + tap(f.uv - off)) * weight(i);
  }
  return sum;
}`;

export const COPY_WGSL = `${FULL}
@fragment fn fs(f: F) -> @location(0) vec4f {
  return textureSampleLevel(src, smp, f.uv, 0.0);
}`;
