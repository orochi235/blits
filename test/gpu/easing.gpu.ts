import { type Curve, curve, curveData } from '../../src/easing.js';
import { EASING_WGSL } from '../../src/gpu/wgsl/easing.js';
import type { Easing } from '../../src/index.js';
import { close, closeNear, readBack, test } from './harness.js';

const US = [...Array.from({ length: 1025 }, (_, i) => i / 1024), 0, 1, -0.1, 1.1].map(Math.fround);

type Case = { name: string; easing: Easing; branchy: boolean };
const CASES: Case[] = [
  ...(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const).map((e) => ({
    name: e,
    easing: e,
    branchy: false,
  })),
  {
    name: 'bezier(0.3, -0.5, 0.7, 1.6)',
    easing: { bezier: [0.3, -0.5, 0.7, 1.6] },
    branchy: false,
  },
  { name: 'bezier(0, 0.9, 0.2, 1)', easing: { bezier: [0, 0.9, 0.2, 1] }, branchy: false },
  ...[1, 4, 7].flatMap((n) =>
    (['start', 'end'] as const).map((jump) => ({
      name: `steps(${n}, ${jump})`,
      easing: { steps: n, jump } as Easing,
      branchy: true,
    })),
  ),
  { name: 'steps(3, none)', easing: { steps: 3, jump: 'none' }, branchy: true },
  { name: 'steps(3, both)', easing: { steps: 3, jump: 'both' }, branchy: true },
  { name: 'linear(0, 0.25, 1)', easing: { linear: [0, 0.25, 1] }, branchy: false },
  {
    name: 'linear(0, 0.5 60%, 0.25 40%, 1)',
    easing: { linear: [0, [0.5, 0.6], [0.25, 0.4], 1] },
    branchy: true,
  },
  {
    name: 'linear(0 20%, 1 80%)',
    easing: {
      linear: [
        [0, 0.2],
        [1, 0.8],
      ],
    },
    branchy: false,
  },
];

test('blits_ease matches the TS curves', async (device) => {
  const curves: Curve[] = CASES.map((c) => curve(c.easing));
  // A linear curve's points follow its head, so each case starts where the one before ended.
  const starts: number[] = [];
  const flat: number[] = [];
  for (const c of curves) {
    starts.push(flat.length);
    flat.push(...(curveData(c) as readonly number[]));
  }
  const values = Float32Array.from(flat);
  const us = new Float32Array(US);
  const total = CASES.length * US.length;
  const code = `${
    /* wgsl */ `
@group(0) @binding(0) var<storage, read> values: array<f32>;
@group(0) @binding(1) var<storage, read> us: array<f32>;
@group(0) @binding(2) var<storage, read_write> outs: array<f32>;
`
  }${EASING_WGSL}
var<private> starts: array<u32, ${starts.length}> = array<u32, ${starts.length}>(${starts.map((s) => `${s}u`).join(', ')});
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= ${total}u) { return; }
  let k = i / ${US.length}u;
  outs[i] = blits_ease(starts[k], us[i % ${US.length}u]);
}`;
  const mk = (bytes: number, usage: number) => device.createBuffer({ size: bytes, usage });
  const a = mk(values.byteLength, 0x80 | 0x08);
  const b = mk(us.byteLength, 0x80 | 0x08);
  const c = mk(total * 4, 0x80 | 0x04);
  device.queue.writeBuffer(a, 0, values);
  device.queue.writeBuffer(b, 0, us);
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
  pass.dispatchWorkgroups(Math.ceil(total / 64));
  pass.end();
  device.queue.submit([enc.finish()]);
  const got = await readBack(device, c, 0, total * 4);
  CASES.forEach((cs, k) => {
    const cpu = curves[k] as Curve;
    US.forEach((u, j) => {
      const g = got[k * US.length + j] as number;
      const what = `${cs.name} at u=${u}`;
      if (cs.branchy) closeNear(g, cpu, u, what);
      else close(g, cpu(u), what);
    });
  });
});
