import { type Handle, kit, mix, mul, patch, sum } from '@msb235/blits';
import { demo } from '../demo';

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
/** How often a burst goes off by itself, ms of mix time. */
const EVERY = 1400;
/** How far back the mix's history reaches, ms. */
const KEPT = 10_000;

const FLY = 1200;
// Out along its angle, pulled down, fading as it goes.
const fly = patch<Spark, SparkPose>(
  FLY,
  (phase, s) => ({
    dx: Math.cos(s.angle) * s.speed * phase,
    dy: Math.sin(s.angle) * s.speed * phase + 140 * phase * phase,
    alpha: 1 - phase * phase,
  }),
  { writes: ['dx', 'dy', 'alpha'] },
);

export default demo((d) => {
  const { root } = d;
  const canvas = document.createElement('canvas');
  canvas.className = 'burst';
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  const m = mix<Spark, SparkPose>(SPARK, d.options('burst', {}, KEPT));
  d.closes(m);
  const bursts = new Set<{ sparks: Spark[]; handle: Handle<Spark>; at: number }>();

  // One voice per burst, for one pass: when it ends the voice leaves the mix. Its sparks are kept
  // while history reaches back to its pass, so a seek back finds them, and drawn while it plays.
  const burst = (x: number, y: number) => {
    const sparks = Array.from({ length: 40 }, () => ({
      x,
      y,
      angle: Math.random() * 2 * Math.PI,
      speed: 40 + Math.random() * 90,
    }));
    bursts.add({ sparks, handle: m.cue({ patch: fly, subjects: sparks }), at: m.now });
  };

  d.on(canvas, 'click', (e) => {
    const box = canvas.getBoundingClientRect();
    burst(e.clientX - box.left, e.clientY - box.top);
  });

  const pose = { dx: 0, dy: 0, alpha: 1 };
  let last = Number.NaN;
  d.frame(m, (now) => {
    m.sync(now);
    if (Number.isNaN(last)) last = m.now;
    if (document.hasFocus() && m.now - last >= EVERY) {
      last = m.now;
      burst(canvas.clientWidth * (0.2 + 0.6 * Math.random()), HEIGHT * (0.3 + 0.3 * Math.random()));
    }
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = HEIGHT * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = getComputedStyle(root).color;
    const playing = new Set(m.voices());
    for (const b of bursts) {
      if (b.at + FLY < m.now - KEPT) bursts.delete(b);
      if (!playing.has(b.handle) || b.handle.state === 'pending') continue;
      for (const s of b.sparks) {
        m.probe(s, pose);
        ctx.globalAlpha = pose.alpha;
        ctx.fillRect(s.x + pose.dx - 2, s.y + pose.dy - 2, 4, 4);
      }
    }
  });
});
