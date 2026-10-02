// Variants 3 and 4: the dense fold as a WGSL compute shader, run through Dawn (the `webgpu`
// package) on Metal.
import { create, globals } from 'webgpu';
import { CHANNELS, delays, packVoices, STRIDE, voiceData } from './workload.mjs';

Object.assign(globalThis, globals);

const WG = 64;
const MAX_VOICES = 8;

// The bezier solve is blits' own, with two float32 concessions: Newton stops at 1e-6 rather than
// 1e-7, and the bisection is capped, since float32 cannot always split an interval below 1e-7.
const SHADER = /* wgsl */ `
struct Frame { now: f32, n: u32, voices: u32, _pad: u32, weights: array<vec4<f32>, ${MAX_VOICES / 4}> }
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> vd: array<f32>;
@group(0) @binding(2) var<storage, read> delay: array<f32>;
@group(0) @binding(3) var<storage, read_write> pose: array<f32>;

fn bez(o: u32, u: f32) -> f32 {
  if (u <= 0.0) { return 0.0; }
  if (u >= 1.0) { return 1.0; }
  let x1 = vd[o]; let y1 = vd[o + 1u]; let x2 = vd[o + 2u]; let y2 = vd[o + 3u];
  let cx = 3.0 * x1; let bx = 3.0 * (x2 - x1) - cx; let ax = 1.0 - cx - bx;
  let cy = 3.0 * y1; let by = 3.0 * (y2 - y1) - cy; let ay = 1.0 - cy - by;
  var t = u;
  for (var i = 0; i < 8; i++) {
    let err = ((ax * t + bx) * t + cx) * t - u;
    if (abs(err) < 1e-6) { return ((ay * t + by) * t + cy) * t; }
    let d = (3.0 * ax * t + 2.0 * bx) * t + cx;
    if (abs(d) < 1e-6) { break; }
    t -= err / d;
  }
  var lo = 0.0; var hi = 1.0; t = u;
  for (var i = 0; i < 24; i++) {
    if (((ax * t + bx) * t + cx) * t < u) { lo = t; } else { hi = t; }
    t = (lo + hi) * 0.5;
  }
  return ((ay * t + by) * t + cy) * t;
}

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = frame.n;
  let i = gid.x;
  if (i >= n) { return; }
  var g = 1.0; var dk = 0.0; var x = 0.0; var y = 0.0; var z = 0.0;
  for (var v = 0u; v < frame.voices; v++) {
    let o = v * ${STRIDE}u;
    let period = vd[o]; let fadeIn = vd[o + 1u]; let start = vd[o + 2u];
    let elapsed = frame.now - start - delay[v * n + i];
    if (elapsed < 0.0) { continue; }
    var w = frame.weights[v / 4u][v % 4u];
    let fu = elapsed / fadeIn;
    if (fu < 1.0) { w *= bez(o + 27u, fu); }
    if (w <= 0.0) { continue; }
    w = min(w, 1.0);
    let phase = (elapsed % period) / period;
    var a = 0u; var u = 0.0;
    if (phase <= 0.5) { u = bez(o + 19u, phase / 0.5); }
    else { a = 1u; u = bez(o + 23u, (phase - 0.5) / 0.5); }
    let gv = mix(vd[o + 4u + a], vd[o + 5u + a], u);
    let dv = mix(vd[o + 7u + a], vd[o + 8u + a], u);
    g *= 1.0 + (gv - 1.0) * w;
    dk = max(dk, dv * w);
    x += mix(vd[o + 10u + a], vd[o + 11u + a], u) * w;
    y += mix(vd[o + 13u + a], vd[o + 14u + a], u) * w;
    z += mix(vd[o + 16u + a], vd[o + 17u + a], u) * w;
  }
  pose[i] = g; pose[n + i] = dk; pose[2u * n + i] = x; pose[3u * n + i] = y; pose[4u * n + i] = z;
}
`;

// Held at module scope: when the GPU object is collected, dawn.node segfaults on the next wait.
let gpu;

export async function device() {
  gpu = create(['backend=metal']);
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const info = adapter.info;
  const fallback = adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? false;
  if (fallback) throw new Error(`fallback adapter only: ${JSON.stringify(info)}`);
  const dev = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  return {
    dev,
    info: `${info.vendor} ${info.device} (${info.architecture}), ${info.description}, fallback=${fallback}`,
  };
}

/** One (N, V) setup: buffers uploaded once, and the per-frame steps the variants time. */
export function setup(dev, n, voices) {
  const { GPUBufferUsage: U, GPUMapMode } = globalThis;
  const module = dev.createShaderModule({ code: SHADER });
  const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const buffer = (size, usage, data) => {
    const b = dev.createBuffer({ size, usage, mappedAtCreation: data !== undefined });
    if (data) {
      new Float32Array(b.getMappedRange()).set(data);
      b.unmap();
    }
    return b;
  };
  const vd = Float32Array.from(packVoices(voices));
  const frameBuf = buffer(16 + MAX_VOICES * 4, U.UNIFORM | U.COPY_DST);
  const vdBuf = buffer(vd.byteLength, U.STORAGE, vd);
  const delayBuf = buffer(n * voices * 4, U.STORAGE, delays(n, voices));
  const bytes = CHANNELS * n * 4;
  const poseBuf = buffer(bytes, U.STORAGE | U.COPY_SRC);
  // Two for double-buffering, one of its own for the single readback.
  const reads = [0, 1, 2].map(() => buffer(bytes, U.MAP_READ | U.COPY_DST));
  const bind = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [frameBuf, vdBuf, delayBuf, poseBuf].map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });
  const uniform = new ArrayBuffer(16 + MAX_VOICES * 4);
  const f32 = new Float32Array(uniform);
  const u32 = new Uint32Array(uniform);
  u32[1] = n;
  u32[2] = voices;
  for (let v = 0; v < voices; v++) f32[4 + v] = voiceData(v).weight;
  const groups = Math.ceil(n / WG);
  const out = new Float32Array(CHANNELS * n);

  /** Writes the frame's uniform and submits the fold, with a copy into `into` when given. */
  function submit(now, into) {
    f32[0] = now;
    dev.queue.writeBuffer(frameBuf, 0, uniform);
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(groups);
    pass.end();
    if (into) enc.copyBufferToBuffer(poseBuf, 0, into, 0, bytes);
    dev.queue.submit([enc.finish()]);
  }
  async function read(buf) {
    await buf.mapAsync(GPUMapMode.READ);
    out.set(new Float32Array(buf.getMappedRange()));
    buf.unmap();
    return out;
  }

  let f = 0;
  let pending = null;
  return {
    out,
    /** Variant 3: fold, and wait until the GPU is done. */
    async noReadback(now) {
      submit(now);
      await dev.queue.onSubmittedWorkDone();
    },
    /** Variant 4: fold, copy, and wait until the pose is in JS. */
    async readback(now) {
      submit(now, reads[2]);
      return read(reads[2]);
    },
    /** Variant 4b: fold frame f, and read frame f-1's pose while it runs. */
    async doubleBuffered(now) {
      const mine = reads[f & 1];
      f++;
      submit(now, mine);
      const mapped = mine.mapAsync(GPUMapMode.READ);
      const prev = pending;
      pending = { buf: mine, mapped };
      if (prev === null) return out;
      await prev.mapped;
      out.set(new Float32Array(prev.buf.getMappedRange()));
      prev.buf.unmap();
      return out;
    },
    /** Waits out a double-buffered run so the next one starts clean. */
    async drain() {
      if (pending) {
        await pending.mapped;
        pending.buf.unmap();
        pending = null;
      }
    },
    destroy() {
      for (const b of [frameBuf, vdBuf, delayBuf, poseBuf, ...reads]) b.destroy();
    },
  };
}

/** The floor under any frame: an empty submit, and a 4-byte map. */
export async function floors(dev, frames = 200) {
  const { GPUBufferUsage: U, GPUMapMode } = globalThis;
  const src = dev.createBuffer({ size: 4, usage: U.COPY_SRC | U.STORAGE });
  const dst = dev.createBuffer({ size: 4, usage: U.COPY_DST | U.MAP_READ });
  const empty = [];
  const map = [];
  for (let i = 0; i < frames + 30; i++) {
    let t0 = performance.now();
    dev.queue.submit([dev.createCommandEncoder().finish()]);
    await dev.queue.onSubmittedWorkDone();
    if (i >= 30) empty.push(performance.now() - t0);
    t0 = performance.now();
    const enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, dst, 0, 4);
    dev.queue.submit([enc.finish()]);
    await dst.mapAsync(GPUMapMode.READ);
    dst.unmap();
    if (i >= 30) map.push(performance.now() - t0);
  }
  src.destroy();
  dst.destroy();
  return { empty, map };
}
