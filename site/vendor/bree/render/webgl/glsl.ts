import { TAPS } from '../blur.js';
import { NO_LIGHT, SOCKET } from '../prims.js';
import { ROW, SDF_GLSL } from './glsl-sdf.js';

/** Where each primitive's attributes sit, shared by every instanced program. */
export const ATTR = { corner: 0, g0: 1, g1: 2, meta: 3 } as const;

const vertex = `#version 300 es
precision highp float;
precision highp int;
layout(location = ${ATTR.corner}) in vec2 a_corner;
layout(location = ${ATTR.g0}) in vec4 a_g0;
layout(location = ${ATTR.g1}) in vec4 a_g1;
layout(location = ${ATTR.meta}) in uvec4 a_meta;
uniform vec2 u_canvas;
uniform float u_lamp;
uniform highp sampler2D u_views;
uniform highp sampler2D u_shows;
${SDF_GLSL}
out vec2 v_local;
flat out int v_kind;
flat out vec4 v_g0;
flat out vec4 v_g1;
flat out float v_r;
flat out float v_px;
flat out vec4 v_clip;
const vec4 NOWHERE = vec4(2.0, 2.0, 2.0, 1.0);
vec4 fetch(highp sampler2D s, int i) { return texelFetch(s, ivec2(i % ${ROW}, i / ${ROW}), 0); }
int v_view() { return int(a_meta.z); }
bool owned() { return a_meta.y != ${NO_LIGHT}u; }
int light() { return int(a_meta.y); }
/** Reads the primitive and its view, and places a quad over its box grown by \`grow\` device px. */
vec4 place(float r, float grow) {
  v_kind = int(a_meta.x);
  v_g0 = a_g0;
  v_g1 = a_g1;
  v_r = r;
  vec4 va = fetch(u_views, v_view() * 2);
  v_clip = fetch(u_views, v_view() * 2 + 1);
  v_px = va.z;
  if (!(va.z > 0.0)) { return NOWHERE; }
  vec4 box = prim_box(v_kind, a_g0, a_g1, r);
  float g = grow / va.z;
  v_local = mix(box.xy - g, box.zw + g, a_corner * 0.5 + 0.5);
  vec2 p = vec2(va.x + (v_local.x - v_local.y * va.w) * va.z, va.y + v_local.y * va.z);
  return vec4(p.x / u_canvas.x * 2.0 - 1.0, 1.0 - p.y / u_canvas.y * 2.0, 0.0, 1.0);
}
float own_radius() { return prim_radius(int(a_meta.x), a_g0, a_g1, u_lamp); }
`;

const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_canvas;
${SDF_GLSL}
in vec2 v_local;
flat in int v_kind;
flat in vec4 v_g0;
flat in vec4 v_g1;
flat in float v_r;
flat in float v_px;
flat in vec4 v_clip;
out vec4 color;
/** The fragment's distance in device px, or discards it outside its view's clip. */
float dist() {
  vec2 at = vec2(gl_FragCoord.x, u_canvas.y - gl_FragCoord.y);
  if (at.x < v_clip.x || at.y < v_clip.y || at.x > v_clip.z || at.y > v_clip.w) { discard; }
  return prim_dist(v_kind, v_g0, v_g1, v_local, v_r) * v_px;
}
`;

/** A primitive's socket or faceplate, drawn into the housing whenever the views change. */
export const HOUSING_VS = `${vertex}
uniform float u_wire;
flat out int v_socket;
void main() {
  v_socket = int(a_meta.w);
  float r = own_radius();
  if (v_socket == ${SOCKET.wire}) {
    vec4 va = fetch(u_views, v_view() * 2);
    r = max(r * u_wire, 0.5 / max(va.z, 1e-6));
  }
  gl_Position = v_socket == ${SOCKET.none} ? NOWHERE : place(r, 1.0);
}`;

export const HOUSING_FS = `${fragment}
uniform vec3 u_sockets[6];
flat in int v_socket;
void main() {
  float cover = 1.0 - smoothstep(-0.5, 0.5, dist());
  color = vec4(u_sockets[v_socket], 1.0) * cover;
}`;

/**
 * A primitive's glow before the blur: a Gaussian round its middle line with the second moment of
 * 2D's halo, carrying the halo's whole light. Without a full-canvas blur the blur's spread is
 * folded into its own width, keeping its light.
 */
export const GLOW_VS = `${vertex}
uniform float u_glow;
uniform float u_blurred;
uniform float u_spread;
out float v_shine;
out vec3 v_rgb;
out float v_sigma;
out float v_peak;
void main() {
  if (!owned()) { gl_Position = NOWHERE; return; }
  vec4 s = fetch(u_shows, light() * 2);
  float bloom = fetch(u_shows, light() * 2 + 1).x;
  float r = own_radius();
  float px = fetch(u_views, v_view() * 2).z;
  float wide = max(bloom * u_glow * prim_glow(int(a_meta.x), a_g0, a_g1), 0.0);
  float halo = r * px * wide;
  float sigma = max(halo * 0.5, 0.7);
  float blur = u_blurred > 0.5 ? 0.0 : px * u_spread * wide;
  v_sigma = sqrt(sigma * sigma + blur * blur);
  v_peak = halo * halo / (2.0 * v_sigma * v_sigma);
  v_shine = s.x;
  v_rgb = s.yzw;
  gl_Position = s.x > 0.0 && halo > 0.0 ? place(r, v_sigma * 3.0) : NOWHERE;
}`;

export const GLOW_FS = `${fragment}
uniform float u_scale;
in float v_shine;
in vec3 v_rgb;
in float v_sigma;
in float v_peak;
void main() {
  float d = max(dist() + v_r * v_px, 0.0);
  float g = v_peak * exp(-(d * d) / (2.0 * v_sigma * v_sigma)) * v_shine * u_scale;
  color = vec4(v_rgb * g, g);
}`;

/** A primitive's lens: its light's color over its shape, a pale core down its middle. */
export const BODY_VS = `${vertex}
out float v_shine;
out vec3 v_rgb;
void main() {
  if (!owned()) { gl_Position = NOWHERE; return; }
  vec4 s = fetch(u_shows, light() * 2);
  v_shine = s.x;
  v_rgb = s.yzw;
  gl_Position = s.x > 0.0 ? place(own_radius(), 1.0) : NOWHERE;
}`;

export const BODY_FS = `${fragment}
uniform float u_core;
uniform vec3 u_coreTint;
uniform float u_coreAlpha;
in float v_shine;
in vec3 v_rgb;
void main() {
  float d = dist();
  float r = v_r * v_px;
  float body = v_shine * (1.0 - smoothstep(-0.5, 0.5, d));
  float rc = r * u_core;
  float soft = max(0.5, rc * 0.25);
  float core = v_shine * u_coreAlpha * (1.0 - smoothstep(-soft, soft, d + r - rc));
  color = vec4(u_coreTint * core + v_rgb * body * (1.0 - core), core + body * (1.0 - core));
}`;

/** A triangle covering the target, its texture coordinates running 0..1 across it. */
export const FULL_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

/** One axis of a Gaussian blur, its weights summing to 1; past the edge is dark, as in 2D. */
export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_step;
uniform float u_weight[${TAPS + 1}];
in vec2 v_uv;
out vec4 color;
vec4 tap(vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture(u_src, uv) * inside.x * inside.y;
}
void main() {
  vec4 sum = tap(v_uv) * u_weight[0];
  for (int i = 1; i <= ${TAPS}; i++) {
    vec2 off = u_step * float(i);
    sum += (tap(v_uv + off) + tap(v_uv - off)) * u_weight[i];
  }
  color = sum;
}`;

export const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform float u_gain;
in vec2 v_uv;
out vec4 color;
void main() {
  color = texture(u_src, v_uv) * u_gain;
}`;
