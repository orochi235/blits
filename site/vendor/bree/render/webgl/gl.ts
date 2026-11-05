import { GEOM, type Prims } from '../prims.js';
import {
  ATTR,
  BLUR_FS,
  BODY_FS,
  BODY_VS,
  COPY_FS,
  FULL_VS,
  GLOW_FS,
  GLOW_VS,
  HOUSING_FS,
  HOUSING_VS,
} from './glsl.js';
import { ROW } from './glsl-sdf.js';

/** A linked program and its uniforms by name. */
export interface Program {
  readonly program: WebGLProgram;
  readonly u: Record<string, WebGLUniformLocation | null>;
}

/** A texture to draw into. */
export interface Target {
  readonly tex: WebGLTexture;
  readonly fb: WebGLFramebuffer;
  readonly w: number;
  readonly h: number;
}

/** Every GL resource a sign holds; rebuilt whole after a lost context. */
export interface Resources {
  readonly housing: Program;
  readonly glow: Program;
  readonly body: Program;
  readonly blur: Program;
  readonly copy: Program;
  /** The primitives, as instances. */
  readonly lights: WebGLVertexArrayObject;
  readonly instances: number;
  /** Nothing bound, for the full-target triangle. */
  readonly empty: WebGLVertexArrayObject;
  /** Two texels per light: shine, r, g, b, then bloom. */
  readonly shows: Data;
  /** Two texels per view: its transform, then its clip. */
  readonly views: Data;
  /** A polyline's points, one texel each. */
  readonly points: Data;
  readonly buffers: readonly WebGLBuffer[];
  /** Whether the glow targets hold half floats rather than bytes. */
  readonly half: boolean;
  targets: { house: Target; splat: Target; across: Target; blurred: Target } | null;
}

/** A float texture holding `texels` items of `channels` floats, `ROW` to a row. */
export interface Data {
  readonly tex: WebGLTexture;
  readonly w: number;
  readonly h: number;
  readonly channels: 2 | 4;
}

function data(gl: WebGL2RenderingContext, texels: number, channels: 2 | 4): Data {
  const w = Math.max(1, Math.min(ROW, texels));
  const h = Math.max(1, Math.ceil(texels / ROW));
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const format = channels === 4 ? gl.RGBA32F : gl.RG32F;
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
  return { tex, w, h, channels };
}

/** Uploads `values` into `d` from its first texel, padding the last row. */
export function upload(gl: WebGL2RenderingContext, d: Data, values: Float32Array): void {
  const full = d.w * d.h * d.channels;
  const src = values.length === full ? values : new Float32Array(full);
  if (src !== values) src.set(values.subarray(0, Math.min(values.length, full)));
  gl.bindTexture(gl.TEXTURE_2D, d.tex);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    d.w,
    d.h,
    d.channels === 4 ? gl.RGBA : gl.RG,
    gl.FLOAT,
    src,
  );
}

const UNIFORMS = [
  'u_canvas',
  'u_views',
  'u_shows',
  'u_points',
  'u_wire',
  'u_sockets',
  'u_blurred',
  'u_spread',
  'u_lamp',
  'u_glow',
  'u_dot',
  'u_bulb',
  'u_scale',
  'u_core',
  'u_coreTint',
  'u_coreAlpha',
  'u_src',
  'u_step',
  'u_weight',
  'u_gain',
];

function program(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost())
      throw new Error(`bree: shader failed: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
    gl.deleteShader(s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost())
    throw new Error(`bree: program failed: ${gl.getProgramInfoLog(p)}`);
  const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(p, n)]));
  return { program: p, u };
}

function attribute(
  gl: WebGL2RenderingContext,
  at: number,
  size: number,
  stride: number,
  offset: number,
  divisor: number,
): void {
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
  gl.vertexAttribDivisor(at, divisor);
}

/** Compiles the programs and uploads the parts of `p` that never change, for `lights` lights. */
export function build(
  gl: WebGL2RenderingContext,
  p: Prims,
  lights: number,
  views: number,
): Resources {
  const half = gl.getExtension('EXT_color_buffer_float') !== null;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corner = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  attribute(gl, ATTR.corner, 2, 0, 0, 0);
  const geom = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, geom);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    p.geom.length > 0 ? p.geom : new Float32Array(GEOM),
    gl.STATIC_DRAW,
  );
  attribute(gl, ATTR.g0, 4, GEOM * 4, 0, 1);
  attribute(gl, ATTR.g1, 4, GEOM * 4, 16, 1);
  const meta = new Uint32Array(Math.max(p.n, 1) * 4);
  for (let k = 0; k < p.n; k++)
    meta.set([p.kind[k] ?? 0, p.light[k] ?? 0, p.view[k] ?? 0, p.socket[k] ?? 0], k * 4);
  const metaBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, metaBuf);
  gl.bufferData(gl.ARRAY_BUFFER, meta, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(ATTR.meta);
  gl.vertexAttribIPointer(ATTR.meta, 4, gl.UNSIGNED_INT, 16, 0);
  gl.vertexAttribDivisor(ATTR.meta, 1);
  gl.bindVertexArray(null);
  const points = data(gl, Math.max(p.points.length / 2, 1), 2);
  upload(gl, points, p.points);
  return {
    housing: program(gl, HOUSING_VS, HOUSING_FS),
    glow: program(gl, GLOW_VS, GLOW_FS),
    body: program(gl, BODY_VS, BODY_FS),
    blur: program(gl, FULL_VS, BLUR_FS),
    copy: program(gl, FULL_VS, COPY_FS),
    lights: vao,
    instances: p.n,
    empty: gl.createVertexArray(),
    shows: data(gl, Math.max(lights, 1) * 2, 4),
    views: data(gl, Math.max(views, 1) * 2, 4),
    points,
    buffers: [corner, geom, metaBuf],
    half,
    targets: null,
  };
}

function target(gl: WebGL2RenderingContext, w: number, h: number, half: boolean): Target {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}

function dropTargets(gl: WebGL2RenderingContext, r: Resources): void {
  for (const t of Object.values(r.targets ?? {})) {
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fb);
  }
  r.targets = null;
}

/** Replaces the targets for a canvas `w` × `h`: housing and splat at full size, the blur at half. */
export function sizeTargets(gl: WebGL2RenderingContext, r: Resources, w: number, h: number): void {
  dropTargets(gl, r);
  if (w === 0 || h === 0) return;
  const hw = Math.max(1, Math.ceil(w / 2));
  const hh = Math.max(1, Math.ceil(h / 2));
  r.targets = {
    house: target(gl, w, h, false),
    splat: target(gl, w, h, r.half),
    across: target(gl, hw, hh, r.half),
    blurred: target(gl, hw, hh, r.half),
  };
}

/** Deletes every resource in `r`. */
export function free(gl: WebGL2RenderingContext, r: Resources): void {
  dropTargets(gl, r);
  for (const p of [r.housing, r.glow, r.body, r.blur, r.copy]) gl.deleteProgram(p.program);
  for (const b of r.buffers) gl.deleteBuffer(b);
  for (const d of [r.shows, r.views, r.points]) gl.deleteTexture(d.tex);
  gl.deleteVertexArray(r.lights);
  gl.deleteVertexArray(r.empty);
}

/** Makes `p` the program draws use. */
export function bind(gl: WebGL2RenderingContext, p: Program): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
  gl.useProgram(p.program);
}
