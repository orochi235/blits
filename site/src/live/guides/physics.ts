import RAPIER from '@dimforge/rapier2d-compat';
import { kit, lag, level, patch, share } from '@msb235/blits';
import { channels2, type Pose2, physics } from '@msb235/blits-rapier';
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

const HEIGHT = 260;
const SCALE = 40; // pixels per meter
const SIZE = 0.3; // half a box's side, meters

// A push to the right that swells and dies away over a second.
const gust = patch<object, Pose2>(
  1000,
  (phase) => ({ force: [Math.sin(phase * Math.PI) * 6, 2] }),
  {
    writes: ['force'],
  },
);

// A place in a tidy row, upright.
const rest = (x: number) =>
  patch<object, Pose2>(0, () => ({ position: [x, SIZE], rotation: 0 }), {
    writes: ['position', 'rotation'],
  });

export default function run(root: HTMLElement): () => void {
  const canvas = document.createElement('canvas');
  canvas.className = 'physics';
  const button = document.createElement('button');
  button.className = 'physics-tidy';
  button.textContent = 'Tidy';
  root.append(canvas, button);
  const ctx = canvas.getContext('2d');
  let stop = () => {};
  let gone = false;

  void RAPIER.init().then(() => {
    if (gone || ctx === null) return;
    const width = canvas.clientWidth / SCALE;
    // 0 leaves the boxes to physics, 1 puts them in their places; `lag` eases each box between.
    const tidied = level<object>(0);
    const toward = lag(tidied, { riseMs: 150, fallMs: 150 });
    const sim = physics(kit<Pose2>(channels2), {
      rapier: RAPIER,
      name: 'physics',
      // Kept so the debug panel can seek back through the last ten seconds.
      history: { ms: 10_000, every: 250, tape: createHistory },
      weight: share(toward, 0, 2),
    });
    sim.body(RAPIER.RigidBodyDesc.fixed(), RAPIER.ColliderDesc.cuboid(width, 0.05));
    sim.body(
      RAPIER.RigidBodyDesc.fixed().setTranslation(-0.05, 3),
      RAPIER.ColliderDesc.cuboid(0.05, 3),
    );
    sim.body(
      RAPIER.RigidBodyDesc.fixed().setTranslation(width + 0.05, 3),
      RAPIER.ColliderDesc.cuboid(0.05, 3),
    );
    const boxes = Array.from({ length: 12 }, (_, i) =>
      sim.body(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(1 + ((i % 6) * (width - 2)) / 5, 3 + Math.floor(i / 6) * 1.2)
          .setRotation(i * 0.4),
        RAPIER.ColliderDesc.cuboid(SIZE, SIZE),
      ),
    );

    // Each box's tidy place plays in the simulation's role, so the two crossfade by weight.
    for (const [i, box] of boxes.entries())
      box.cue({
        patch: rest(0.6 + (i * (width - 1.2)) / 11),
        role: sim.role,
        weight: share(toward, 1, 2),
      });
    let tidy = false;
    button.addEventListener('click', () => {
      tidy = !tidy;
      tidied.set(tidy ? 1 : 0);
      button.textContent = tidy ? 'Let go' : 'Tidy';
    });
    canvas.addEventListener('click', () => {
      for (const box of boxes) box.drive({ patch: gust });
    });

    const pose = sim.mix.pose();
    stop = loop(sim.mix, root, (now) => {
      sim.sync(now);
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = HEIGHT * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.fillStyle = getComputedStyle(root).color;
      ctx.fillRect(0, HEIGHT - 2, canvas.clientWidth, 2);
      for (const box of boxes) {
        sim.mix.probe(box, pose);
        ctx.save();
        ctx.translate(pose.position[0] * SCALE, HEIGHT - pose.position[1] * SCALE);
        ctx.rotate(-pose.rotation);
        ctx.fillRect(-SIZE * SCALE, -SIZE * SCALE, 2 * SIZE * SCALE, 2 * SIZE * SCALE);
        ctx.restore();
      }
    });
  });

  return () => {
    gone = true;
    stop();
    canvas.remove();
    button.remove();
  };
}
