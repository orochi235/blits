import { color, kit, mix, mul, oklab, patch, quat, sum, toHex, type Vec, vec } from '@msb235/blits';

// The parts of three's Mesh this uses, so the site needn't depend on three.
interface Mesh {
  position: { set(x: number, y: number, z: number): unknown };
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
  scale: { setScalar(s: number): unknown };
  material: { color: { setHex(hex: number): unknown } };
}
declare const meshes: Mesh[];
declare const renderer: { render(): void };
// ---
// The subject: a mesh, where it rests, and its place in the row.
interface Part {
  mesh: Mesh;
  home: Vec<3>;
  index: number;
}

interface Pose {
  offset: Vec<3>;
  turn: Vec<4>;
  size: number;
  tint: number[];
}

const PART = kit<Pose>({
  offset: vec(3, sum()), // offsets add, axis by axis
  turn: quat(), // rotations compose, in the order their voices were cued
  size: mul(),
  tint: color(), // OKLab, averaged by weight
});

const bob = patch<Part, Pose>(
  2000,
  (phase) => ({ offset: [0, 0.2 * Math.sin(2 * Math.PI * phase), 0] }),
  { writes: ['offset'] },
);

const spin = patch<Part, Pose>(
  4000,
  (phase) => ({ turn: [0, Math.sin(Math.PI * phase), 0, Math.cos(Math.PI * phase)] }),
  { writes: ['turn'] },
);

const warm = oklab(0xff8a3d);
const glow = patch<Part, Pose>(0, () => ({ tint: warm }), { writes: ['tint'] });

const parts: Part[] = meshes.map((mesh, index) => ({ mesh, home: [index * 1.5, 0, 0], index }));

const m = mix<Part, Pose>(PART, { name: 'meshes' });
m.cue({ patch: bob, loop: true, stagger: (part) => part.index * 150 });
m.cue({ patch: spin, loop: true });

// One pose object for every part: probe writes its arrays in place, so copy them out at once.
const pose: Pose = { offset: [0, 0, 0], turn: [0, 0, 0, 1], size: 1, tint: [0, 0, 0, 0] };

function frame(now: number) {
  m.sync(now);
  for (const part of parts) {
    m.probe(part, pose);
    const [x, y, z] = pose.offset;
    part.mesh.position.set(part.home[0] + x, part.home[1] + y, part.home[2] + z);
    const [qx, qy, qz, qw] = pose.turn;
    part.mesh.quaternion.set(qx, qy, qz, qw);
    part.mesh.scale.setScalar(pose.size);
    part.mesh.material.color.setHex(toHex(pose.tint, 0x8899aa));
  }
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Glow while the pointer is over a part: cue on enter, fade on leave.
export function hover(part: Part): () => void {
  const h = m.cue({ patch: glow, subjects: [part], fade: { in: 200, out: 400 } });
  return () => h.fade();
}
