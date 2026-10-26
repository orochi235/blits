import { type Handle, kit, mix, mul, patch, sum } from '@msb235/blits';
import { loop } from '../loop';

interface Spark {
  x: number;
  y: number;
  angle: number;
  speed: number;
}
interface SparkPose {
  dx: number;
  dy: number;
  alpha: number;
}

const SPARK = kit<SparkPose>({ dx: sum(), dy: sum(), alpha: mul() });

const HEIGHT = 260;

// Out along its angle, pulled down, fading as it goes.
const fly = patch<Spark, SparkPose>(
  1200,
  (phase, s) => ({
    dx: Math.cos(s.angle) * s.speed * phase,
    dy: Math.sin(s.angle) * s.speed * phase + 140 * phase * phase,
    alpha: 1 - phase * phase,
  }),
  { writes: ['dx', 'dy', 'alpha'] },
);

export default function run(root: HTMLElement): () => void {
  const canvas = document.createElement('canvas');
  canvas.className = 'burst';
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return () => {};

  const m = mix<Spark, SparkPose>(SPARK, { name: 'burst' });
  const bursts = new Set<{ sparks: Spark[]; handle: Handle<Spark> }>();

  // One voice per burst, for one pass: when it ends the voice leaves the mix, and its sparks go.
  const burst = (x: number, y: number) => {
    const sparks = Array.from({ length: 40 }, () => ({
      x,
      y,
      angle: Math.random() * 2 * Math.PI,
      speed: 40 + Math.random() * 90,
    }));
    const b = { sparks, handle: m.cue({ patch: fly, subjects: sparks }) };
    bursts.add(b);
    void b.handle.done.then(() => bursts.delete(b));
  };

  const onClick = (e: MouseEvent) => {
    const box = canvas.getBoundingClientRect();
    burst(e.clientX - box.left, e.clientY - box.top);
  };
  canvas.addEventListener('click', onClick);
  const auto = window.setInterval(() => {
    if (!document.hasFocus()) return;
    burst(canvas.clientWidth * (0.2 + 0.6 * Math.random()), HEIGHT * (0.3 + 0.3 * Math.random()));
  }, 1400);

  const pose = { dx: 0, dy: 0, alpha: 1 };
  const stop = loop(m, (now) => {
    m.sync(now);
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = HEIGHT * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = getComputedStyle(root).color;
    for (const { sparks } of bursts)
      for (const s of sparks) {
        m.probe(s, pose);
        ctx.globalAlpha = pose.alpha;
        ctx.fillRect(s.x + pose.dx - 2, s.y + pose.dy - 2, 4, 4);
      }
  });

  return () => {
    clearInterval(auto);
    stop();
    canvas.removeEventListener('click', onClick);
    m.close();
  };
}
