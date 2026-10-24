import { kit, mix, mul, patch, sum, type Vec, vec } from '@msb235/blits';

// The parts of three's InstancedMesh this uses: a 4×4 column-major matrix per instance.
interface InstancedMesh {
  count: number;
  instanceMatrix: { array: Float32Array; needsUpdate: boolean };
}
declare const field: InstancedMesh;
declare const grid: (i: number) => { x: number; z: number };
// ---
interface Pose {
  offset: Vec<3>;
  size: number;
}

const DOT = kit<Pose>({ offset: vec(3, sum()), size: mul() });

const wave = patch<number, Pose>(
  1800,
  (phase) => ({ offset: [0, 0.3 * Math.sin(2 * Math.PI * phase), 0] }),
  { writes: ['offset'] },
);

// The subjects are instance indices. Numbers are their own keys.
const instances = Array.from({ length: field.count }, (_, i) => i);

const m = mix<number, Pose>(DOT, { name: 'field' });
m.cue({ patch: wave, loop: true, stagger: (i) => (grid(i).x + grid(i).z) * 60 });

// One column per channel: three numbers per instance for offset, one for size.
const offset = new Float64Array(instances.length * 3);
const size = new Float64Array(instances.length);

function frame(now: number) {
  m.sync(now);
  // The same array, in the same order, every frame: the mix skips looking subjects up again.
  m.pull(instances, { offset, size });
  const out = field.instanceMatrix.array;
  for (const i of instances) {
    const { x, z } = grid(i);
    const s = size[i] ?? 1;
    const o = i * 16;
    out.fill(0, o, o + 16);
    out[o] = out[o + 5] = out[o + 10] = s;
    out[o + 12] = x + (offset[i * 3] ?? 0);
    out[o + 13] = offset[i * 3 + 1] ?? 0;
    out[o + 14] = z + (offset[i * 3 + 2] ?? 0);
    out[o + 15] = 1;
  }
  field.instanceMatrix.needsUpdate = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
