import {
  color,
  kit,
  mix,
  mul,
  oklab,
  patch,
  quat,
  sum,
  toHex,
  transport,
  type Vec,
  vec,
} from '@msb235/blits';
import { offer } from '@msb235/blits-panel';
import { createHistory } from '@weasel-js/history';
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  DirectionalLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { loop } from '../loop';

const HEIGHT = 360;
const BASE = 0x8899aa;

// Meshes as subjects: a part is a mesh, where it rests, and its place in the row.
interface Part {
  mesh: Mesh<IcosahedronGeometry | BoxGeometry, MeshStandardMaterial>;
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
  offset: vec(3, sum()),
  turn: quat(),
  size: mul(),
  tint: color(),
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

// Instances as subjects: the indices of an InstancedMesh, read with pull.
interface Dot {
  offset: Vec<3>;
  size: number;
}

const DOT = kit<Dot>({ offset: vec(3, sum()), size: mul() });

const wave = patch<number, Dot>(
  1800,
  (phase) => ({ offset: [0, 0.3 * Math.sin(2 * Math.PI * phase), 0] }),
  { writes: ['offset'] },
);

const COLS = 28;
const ROWS = 10;
const GAP = 0.36;
const grid = (i: number) => ({ x: (i % COLS) * GAP, z: Math.floor(i / COLS) * GAP });

export default function run(root: HTMLElement): () => void {
  const canvas = document.createElement('canvas');
  canvas.className = 'three-scene';
  root.append(canvas);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(devicePixelRatio);
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 2, 0.1, 50);
  camera.position.set(0, 2.8, 6.2);
  camera.lookAt(0, 0.2, 0);
  const sun = new DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 6, 4);
  scene.add(new AmbientLight(0xffffff, 0.9), sun);

  const shapes = [new IcosahedronGeometry(0.5, 0), new BoxGeometry(0.75, 0.75, 0.75)];
  const parts: Part[] = Array.from({ length: 6 }, (_, index) => {
    const geometry = shapes[index % 2] as IcosahedronGeometry | BoxGeometry;
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ flatShading: true }));
    scene.add(mesh);
    return { mesh, home: [(index - 2.5) * 1.5, 1, 1.2], index };
  });

  const dotGeometry = new BoxGeometry(0.22, 0.22, 0.22);
  const dotMaterial = new MeshStandardMaterial({ color: 0x5f8fb8 });
  const field = new InstancedMesh(dotGeometry, dotMaterial, COLS * ROWS);
  field.position.set((-(COLS - 1) * GAP) / 2, -0.7, -(ROWS - 1) * GAP + 0.4);
  scene.add(field);

  // Both mixes keep time on one transport, which the debug panel can pause and seek.
  const show = transport({ history: { ms: 10_000, every: 250, tape: createHistory } });

  const m = mix<Part, Pose>(PART, { name: 'meshes', transport: show });
  m.cue({ patch: bob, loop: true, stagger: (part) => part.index * 150, name: 'bob' });
  m.cue({ patch: spin, loop: true, name: 'spin' });

  const instances = Array.from({ length: field.count }, (_, i) => i);
  const f = mix<number, Dot>(DOT, { name: 'field', transport: show });
  f.cue({ patch: wave, loop: true, stagger: (i) => (grid(i).x + grid(i).z) * 60, name: 'wave' });

  const pose: Pose = { offset: [0, 0, 0], turn: [0, 0, 0, 1], size: 1, tint: [0, 0, 0, 0] };
  const offset = new Float64Array(instances.length * 3);
  const size = new Float64Array(instances.length);

  // Glow while the pointer is over a part: cue on enter, fade on leave.
  const ray = new Raycaster();
  const at = new Vector2();
  const under = (x: number, y: number) => {
    const box = canvas.getBoundingClientRect();
    at.set(((x - box.left) / box.width) * 2 - 1, -((y - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(at, camera);
    return ray.intersectObjects([...parts.map((p) => p.mesh), field], false)[0];
  };
  const partOf = (hit: ReturnType<typeof under>) => parts.find((p) => p.mesh === hit?.object);

  let hovered: Part | undefined;
  let release = () => {};
  const point = (ev: PointerEvent) => {
    const part = partOf(under(ev.clientX, ev.clientY));
    if (part === hovered) return;
    release();
    hovered = part;
    canvas.classList.toggle('three-over', part !== undefined);
    if (part === undefined) {
      release = () => {};
      return;
    }
    const h = m.cue({ patch: glow, subjects: [part], fade: { in: 200, out: 400 }, name: 'glow' });
    release = () => h.fade();
  };
  const leave = () => {
    release();
    release = () => {};
    hovered = undefined;
    canvas.classList.remove('three-over');
  };
  canvas.addEventListener('pointermove', point);
  canvas.addEventListener('pointerleave', leave);

  // Lets the debug panel's pick find a part, or an instance by its index, under the pointer.
  const matrix = new Matrix4();
  const corner = new Vector3();
  const screenBox = (box: Box3) => {
    const rect = canvas.getBoundingClientRect();
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      corner
        .set(
          c & 1 ? box.max.x : box.min.x,
          c & 2 ? box.max.y : box.min.y,
          c & 4 ? box.max.z : box.min.z,
        )
        .project(camera);
      const x = rect.left + ((corner.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - corner.y) / 2) * rect.height;
      [left, top, right, bottom] = [
        Math.min(left, x),
        Math.min(top, y),
        Math.max(right, x),
        Math.max(bottom, y),
      ];
    }
    return new DOMRect(left, top, right - left, bottom - top);
  };
  offer({
    pick: (x, y) => {
      const hit = under(x, y);
      return hit?.object === field ? hit.instanceId : partOf(hit);
    },
    outline: (subject) => {
      if (typeof subject === 'number') {
        field.getMatrixAt(subject, matrix);
        dotGeometry.computeBoundingBox();
        const box = (dotGeometry.boundingBox as Box3).clone().applyMatrix4(matrix);
        return screenBox(box.applyMatrix4(field.matrixWorld));
      }
      const part = parts.find((p) => p === subject);
      return part === undefined ? undefined : screenBox(new Box3().setFromObject(part.mesh));
    },
  });

  const stop = loop(show, (now) => {
    show.sync(now);

    for (const part of parts) {
      m.probe(part, pose);
      const [x, y, z] = pose.offset;
      part.mesh.position.set(part.home[0] + x, part.home[1] + y, part.home[2] + z);
      const [qx, qy, qz, qw] = pose.turn;
      part.mesh.quaternion.set(qx, qy, qz, qw);
      part.mesh.scale.setScalar(pose.size);
      part.mesh.material.color.setHex(toHex(pose.tint, BASE));
    }

    f.pull(instances, { offset, size });
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

    const width = canvas.clientWidth;
    if (canvas.width !== Math.round(width * devicePixelRatio)) {
      renderer.setSize(width, HEIGHT, false);
      camera.aspect = width / HEIGHT;
      // Wide enough for the whole row however narrow the column.
      const half = Math.atan(5 / 5.4 / camera.aspect);
      camera.fov = Math.max(34, (2 * half * 180) / Math.PI);
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  });

  return () => {
    stop();
    release();
    offer({});
    canvas.removeEventListener('pointermove', point);
    canvas.removeEventListener('pointerleave', leave);
    m.close();
    f.close();
    for (const g of [...shapes, dotGeometry]) g.dispose();
    for (const p of parts) p.mesh.material.dispose();
    dotMaterial.dispose();
    field.dispose();
    renderer.dispose();
    canvas.remove();
  };
}
