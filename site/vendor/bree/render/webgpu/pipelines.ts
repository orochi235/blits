import { rgb } from '../../color.js';
import { BLOOM } from '../bloom-params.js';
import { gaussian, TAPS } from '../blur.js';
import { backingRgba, type HousingPaint } from '../housing.js';
import { LED } from '../lights.js';
import { VIEW } from '../placement.js';
import { GEOM, type Prims } from '../prims.js';
import { SOCKET_COLORS, WIRE_SHARE } from '../sign2d.js';
import { BUFFER, STAGE, TEXTURE } from './usage.js';
import {
  BLUR_WGSL,
  BODY_WGSL,
  COPY_WGSL,
  GLOW_WGSL,
  HOUSING_WGSL,
  LOOK_FLOATS,
} from './wgsl-draw.js';

/**
 * How the lights are drawn this frame: the pitch in device pixels a full-canvas blur spreads by,
 * whether there is one, and `Lamps`' size and glow.
 */
export interface Look {
  readonly pitch: number;
  readonly blurred: boolean;
  readonly lamp: number;
  readonly glow: number;
}

/** The WebGL sign's draw (`webgl/sign.ts`) in WebGPU, from the optics' `shows` buffer. */
export interface Painter {
  /** Makes the targets for a canvas `w` × `h` and paints the housing into one. */
  size(w: number, h: number, look: Look, paint: HousingPaint, views: Float32Array): void;
  /** Paints the housing again, the views having moved. */
  repaint(look: Look, paint: HousingPaint, views: Float32Array): void;
  /** Records the frame into `enc`, drawn to `view`. */
  draw(enc: GPUCommandEncoder, view: GPUTextureView, look: Look): void;
  destroy(): void;
}

const GLOW = 'rgba16float';
/** A blur's uniforms: its step, then its weights four to a vec4. */
const BLUR_FLOATS = 4 + 4 * Math.ceil((TAPS + 1) / 4);
const HOUSE = 'rgba8unorm';
const ADD: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one' },
  alpha: { srcFactor: 'one', dstFactor: 'one' },
};
const OVER: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
};

interface Target {
  readonly tex: GPUTexture;
  readonly view: GPUTextureView;
}

export function createPainter(
  device: GPUDevice,
  format: GPUTextureFormat,
  prims: Prims,
  shows: GPUBuffer,
  viewCount: number,
): Painter {
  const n = prims.n;
  const V = STAGE.VERTEX;
  const F = STAGE.FRAGMENT;
  const lightLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: V | F, buffer: { type: 'read-only-storage' } },
    ],
  });
  const texEntries: GPUBindGroupLayoutEntry[] = [
    { binding: 0, visibility: F, sampler: { type: 'filtering' } },
    { binding: 1, visibility: F, texture: { sampleType: 'float' } },
  ];
  const copyLayout = device.createBindGroupLayout({ entries: texEntries });
  const blurLayout = device.createBindGroupLayout({
    entries: [...texEntries, { binding: 2, visibility: F, buffer: { type: 'uniform' } }],
  });
  const pipe = (
    code: string,
    layout: GPUBindGroupLayout,
    to: GPUTextureFormat,
    blend: GPUBlendState | undefined,
    strip: boolean,
  ) => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [{ format: to, ...(blend ? { blend } : {}) }],
      },
      primitive: { topology: strip ? 'triangle-strip' : 'triangle-list' },
    });
  };
  const housing = pipe(HOUSING_WGSL, lightLayout, HOUSE, OVER, true);
  const glow = pipe(GLOW_WGSL, lightLayout, GLOW, ADD, true);
  const body = pipe(BODY_WGSL, lightLayout, format, ADD, true);
  const blur = pipe(BLUR_WGSL, blurLayout, GLOW, undefined, false);
  const copy = pipe(COPY_WGSL, copyLayout, format, undefined, false);
  const copyAdd = pipe(COPY_WGSL, copyLayout, format, ADD, false);

  const storage = (data: Float32Array | Uint32Array, label: string) => {
    const buf = device.createBuffer({
      size: Math.max(16, data.byteLength),
      usage: BUFFER.STORAGE | BUFFER.COPY_DST,
      label: `bree ${label}`,
    });
    if (data.byteLength > 0) device.queue.writeBuffer(buf, 0, data as Float32Array<ArrayBuffer>);
    return buf;
  };
  const info = new Uint32Array(Math.max(n, 1) * 4);
  for (let k = 0; k < n; k++)
    info.set(
      [prims.kind[k] ?? 0, prims.light[k] ?? 0, prims.view[k] ?? 0, prims.socket[k] ?? 0],
      k * 4,
    );
  const geomBuf = storage(prims.geom.length > 0 ? prims.geom : new Float32Array(GEOM), 'prims');
  const infoBuf = storage(info, 'prim info');
  const viewsBuf = storage(new Float32Array(Math.max(viewCount, 1) * VIEW), 'views');
  const pointsBuf = storage(prims.points.length > 0 ? prims.points : new Float32Array(2), 'points');
  const uniform = (size: number) =>
    device.createBuffer({ size, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
  const lightU = uniform(LOOK_FLOATS * 4);
  const blurU = [uniform(BLUR_FLOATS * 4), uniform(BLUR_FLOATS * 4)] as const;
  const lights = device.createBindGroup({
    layout: lightLayout,
    entries: [lightU, geomBuf, shows, infoBuf, viewsBuf, pointsBuf].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const lightData = new Float32Array(LOOK_FLOATS);
  lightData.set([LED.core, LED.coreAlpha, WIRE_SHARE], 4);
  lightData.set([...rgb(LED.coreTint), 1], 12);
  for (let k = 0; k < 6; k++) lightData.set([...rgb(SOCKET_COLORS[k] ?? 0), 1], 16 + k * 4);

  let canvas = { w: 0, h: 0 };
  let half = { w: 1, h: 1 };
  let blank = false;
  let targets: { house: Target; splat: Target; across: Target; blurred: Target } | null = null;
  let groups: {
    house: GPUBindGroup;
    splat: GPUBindGroup;
    blurX: GPUBindGroup;
    blurY: GPUBindGroup;
    blurred: GPUBindGroup;
  } | null = null;

  const target = (w: number, h: number, f: GPUTextureFormat): Target => {
    const tex = device.createTexture({
      size: [w, h],
      format: f,
      usage: TEXTURE.RENDER_ATTACHMENT | TEXTURE.TEXTURE_BINDING,
    });
    return { tex, view: tex.createView() };
  };
  const texGroup = (layout: GPUBindGroupLayout, t: Target, u?: GPUBuffer) =>
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: t.view },
        ...(u ? [{ binding: 2, resource: { buffer: u } }] : []),
      ],
    });
  const writeLook = (look: Look) => {
    lightData.set([canvas.w, canvas.h, look.lamp, look.glow], 0);
    lightData.set([look.blurred ? 1 : 0, BLOOM.spread], 7);
    device.queue.writeBuffer(lightU, 0, lightData);
  };
  const drop = () => {
    for (const t of Object.values(targets ?? {})) t.tex.destroy();
    targets = null;
    groups = null;
  };
  const instances = (enc: GPURenderPassEncoder, p: GPURenderPipeline) => {
    enc.setPipeline(p);
    enc.setBindGroup(0, lights);
    enc.draw(4, n);
  };
  const full = (enc: GPURenderPassEncoder, p: GPURenderPipeline, g: GPUBindGroup) => {
    enc.setPipeline(p);
    enc.setBindGroup(0, g);
    enc.draw(3);
  };
  const into = (enc: GPUCommandEncoder, view: GPUTextureView, clear: GPUColor = [0, 0, 0, 0]) =>
    enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: clear }],
    });
  /** Writes the weights of a blur `sigma` texels of `src` wide into `u`, along x or y. */
  const weigh = (u: GPUBuffer, sigma: number, src: { w: number; h: number }, x: boolean) => {
    const { weights, spacing } = gaussian(sigma);
    const data = new Float32Array(BLUR_FLOATS);
    data.set([x ? spacing / src.w : 0, x ? 0 : spacing / src.h], 0);
    data.set(weights, 4);
    device.queue.writeBuffer(u, 0, data);
  };

  return {
    size(w, h, look, paint, views) {
      drop();
      canvas = { w, h };
      half = { w: Math.max(1, Math.ceil(w / 2)), h: Math.max(1, Math.ceil(h / 2)) };
      if (w === 0 || h === 0) return;
      const t = {
        house: target(w, h, HOUSE),
        splat: target(w, h, GLOW),
        across: target(half.w, half.h, GLOW),
        blurred: target(half.w, half.h, GLOW),
      };
      targets = t;
      groups = {
        house: texGroup(copyLayout, t.house),
        splat: texGroup(copyLayout, t.splat),
        blurX: texGroup(blurLayout, t.splat, blurU[0]),
        blurY: texGroup(blurLayout, t.across, blurU[1]),
        blurred: texGroup(copyLayout, t.blurred),
      };
      this.repaint(look, paint, views);
    },
    repaint(look, paint, views) {
      const t = targets;
      if (!t) return;
      device.queue.writeBuffer(viewsBuf, 0, views.subarray(0, Math.max(viewCount, 1) * VIEW));
      writeLook(look);
      const enc = device.createCommandEncoder();
      blank = paint.blank;
      const pass = into(enc, t.house.view, backingRgba(paint));
      if (paint.sockets) instances(pass, housing);
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    draw(enc, view, look) {
      const t = targets;
      const g = groups;
      if (!t || !g) return;
      writeLook(look);
      const sigma = look.blurred ? look.pitch * BLOOM.spread * look.glow : 0;
      const glows = look.glow > 0;
      if (glows) {
        const splat = into(enc, t.splat.view);
        instances(splat, glow);
        splat.end();
      }
      if (glows && sigma > 0) {
        weigh(blurU[0], sigma, canvas, true);
        weigh(blurU[1], sigma / 2, half, false);
        const across = into(enc, t.across.view);
        full(across, blur, g.blurX);
        across.end();
        const blurred = into(enc, t.blurred.view);
        full(blurred, blur, g.blurY);
        blurred.end();
      }
      const out = into(enc, view);
      if (!blank) full(out, copy, g.house);
      // As in 2D, glow and bodies both add onto the housing.
      if (glows) full(out, copyAdd, sigma > 0 ? g.blurred : g.splat);
      instances(out, body);
      out.end();
    },
    destroy() {
      drop();
      for (const b of [geomBuf, infoBuf, viewsBuf, pointsBuf, lightU, ...blurU]) b.destroy();
    },
  };
}
