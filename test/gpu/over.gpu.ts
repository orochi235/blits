import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { OVER_WGSL } from '../../src/gpu/wgsl/over.js';
import * as blits from '../../src/index.js';
import { type Channel, color, oklab, toHex } from '../../src/index.js';
import { readBack, test } from './harness.js';

const N = 400;
/** A seeded random number, so a failure repeats. */
let seed = 1;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const hex = () => Math.floor(rand() * 0xffffff);

/** A contribution of a random color at a random coverage, the shape patches give a color channel. */
function contribution(): number[] {
  const [L = 0, a = 0, b = 0] = oklab(hex());
  const cov = rand() < 0.2 ? 1 + rand() : rand();
  return [L * cov, a * cov, b * cov, cov];
}

/** `count` voices folded into the channel's rest, each at a random weight. */
function pose(ch: Channel<number[]>, count: number): number[] {
  let p = [...(ch.rest as number[])];
  for (let k = 0; k < count; k++) {
    const fold = ch.fold as unknown as (into: number[], v: number[], w: number) => number[];
    p = fold(p, contribution(), rand());
  }
  return p;
}

/** Lays each pose over its base on the GPU with OVER_WGSL; compares the bytes with toHex. */
async function agree(device: GpuDevice, ch: Channel<number[]>, body: string): Promise<void> {
  const width = (ch.rest as number[]).length;
  const poses = Array.from({ length: N }, () => pose(ch, 1 + Math.floor(rand() * 5)));
  const unders = Array.from({ length: N }, hex);
  const data = new Float32Array(N * width);
  poses.forEach((p, i) => data.set(p, i * width));
  const base = new Float32Array(N * 4);
  unders.forEach((u, i) =>
    base.set([(u >> 16) / 255, ((u >> 8) & 0xff) / 255, (u & 0xff) / 255, 0], i * 4),
  );
  const code = `${OVER_WGSL}
@group(0) @binding(0) var<storage, read> poses: array<f32>;
@group(0) @binding(1) var<storage, read> unders: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outs: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= ${N}u) { return; }
  let o = i * ${width}u;
  let under = blits_decode(unders[i].xyz);
  ${body}
  outs[i] = vec4f(blits_encode(shown), 0.0);
}`;
  const mk = (bytes: number, usage: number) => device.createBuffer({ size: bytes, usage });
  const a = mk(data.byteLength, 0x80 | 0x08);
  const b = mk(base.byteLength, 0x80 | 0x08);
  const c = mk(N * 16, 0x80 | 0x04);
  device.queue.writeBuffer(a, 0, data);
  device.queue.writeBuffer(b, 0, base);
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  });
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [a, b, c].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(N / 64));
  pass.end();
  device.queue.submit([enc.finish()]);
  const got = await readBack(device, c, 0, N * 16);
  poses.forEach((p, i) => {
    const want = toHex(p, unders[i]);
    const bytes = [want >> 16, (want >> 8) & 0xff, want & 0xff];
    for (let k = 0; k < 3; k++) {
      const g = Math.round((got[i * 4 + k] as number) * 255);
      if (Math.abs(g - (bytes[k] as number)) > 1)
        throw new Error(
          `pose ${i} [${p.map((v) => v.toFixed(4))}] over #${unders[i]?.toString(16)}: GPU byte ${k} ${g}, toHex ${bytes[k]}`,
        );
    }
  });
}

test('blits_over_color matches toHex for color()', (d) =>
  agree(
    d,
    color(),
    'let shown = blits_over_color(vec4f(poses[o], poses[o + 1u], poses[o + 2u], poses[o + 3u]), under);',
  ));

for (const name of ['multiply', 'screen', 'add', 'lighten', 'darken'])
  test(`blits_over_free matches toHex for ${name}`, (d) =>
    agree(
      d,
      color((blits as unknown as Record<string, () => Channel<number>>)[name]!()),
      'let shown = blits_over_free(vec4f(poses[o], poses[o + 1u], poses[o + 2u], poses[o + 3u]), under);',
    ));

const ORDERED = [
  'overlay',
  'softLight',
  'hardLight',
  'difference',
  'colorDodge',
  'colorBurn',
  'exclusion',
  'subtract',
  'divide',
  'linearBurn',
  'vividLight',
  'linearLight',
  'pinLight',
  'hardMix',
  'hue',
  'saturation',
  'colorMode',
  'luminosity',
  'darkerColor',
  'lighterColor',
];
for (const name of ORDERED)
  test(`blits_lay matches toHex for ${name}`, (d) =>
    agree(
      d,
      color((blits as unknown as Record<string, () => Channel<number>>)[name]!()),
      `var shown = under;
  let n = u32(poses[o + 1u]);
  for (var k = 0u; k < n; k++) {
    let at = o + 2u + 4u * k;
    shown = blits_lay(poses[o], shown, vec4f(poses[at], poses[at + 1u], poses[at + 2u], poses[at + 3u]));
  }
  shown = blits_clip(shown);`,
    ));
