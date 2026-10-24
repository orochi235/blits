import { input, kit, mix, patch, sum } from '@msb235/blits';

interface Dot {
  x: number;
  y: number;
  /** Distance from the middle, 0..1. */
  r: number;
}
interface DotPose {
  lift: number;
  size: number;
}

const DOT = kit<DotPose>({ lift: sum(), size: sum() });

const ripple = patch<Dot, DotPose>(1600, (phase) => ({ lift: Math.sin(phase * 2 * Math.PI) }), {
  writes: ['lift'],
});

// Duration 0: no passes, so it holds until faded.
const swell = patch<Dot, DotPose>(0, () => ({ size: 1 }), { writes: ['size'] });

const HEIGHT = 260;

export default function run(root: HTMLElement): () => void {
  const canvas = document.createElement('canvas');
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return () => {};

  const cols = 40;
  const rows = 12;
  const dots: Dot[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) / cols;
      const y = (j + 0.5) / rows;
      dots.push({ x, y, r: Math.hypot(x - 0.5, (y - 0.5) * 0.4) / 0.55 });
    }

  // A signal is a 0..1 number from outside the clock. This one is how near the pointer is.
  let px = -1;
  let py = -1;
  const near = input<Dot>((dot) => {
    const cells = Math.hypot((dot.x - px) * cols, (dot.y - py) * rows);
    return Math.max(0, 1 - cells / 4);
  });
  canvas.addEventListener('pointermove', (e) => {
    const box = canvas.getBoundingClientRect();
    px = (e.clientX - box.left) / box.width;
    py = (e.clientY - box.top) / box.height;
    near.touch();
  });
  canvas.addEventListener('pointerleave', () => {
    px = py = -1;
    near.touch();
  });

  const m = mix<Dot, DotPose>(DOT, { name: 'get started: canvas' });
  // One voice reaches all 480 dots, each delayed by its distance from the middle.
  m.cue({ patch: ripple, loop: true, stagger: (dot) => dot.r * 1200 });
  // A voice's weight can be a signal, read per subject: the swell is as strong as the pointer is near.
  m.cue({ patch: swell, weight: near });

  const pose = { lift: 0, size: 0 };
  let id = requestAnimationFrame(function frame(now) {
    m.sync(now);
    const width = canvas.clientWidth;
    canvas.width = width * devicePixelRatio;
    canvas.height = HEIGHT * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = getComputedStyle(root).color;
    for (const dot of dots) {
      m.probe(dot, pose);
      ctx.globalAlpha = 0.6 + 0.3 * pose.lift + 0.1 * pose.size;
      ctx.beginPath();
      ctx.arc(
        dot.x * width,
        dot.y * HEIGHT - pose.lift * 5,
        2 + pose.lift + pose.size * 5,
        0,
        2 * Math.PI,
      );
      ctx.fill();
    }
    id = requestAnimationFrame(frame);
  });

  return () => {
    cancelAnimationFrame(id);
    m.close();
  };
}
