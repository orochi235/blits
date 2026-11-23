import { type Handle, kit, mix, mul, patch, sum } from '@msb235/blits';
import { demo, KEPT } from '../demo';

interface Spark {
  /** Where its burst went off, as a share of the canvas's width. */
  x: number;
  y: number;
  /** Which of Auto's bursts it belongs to, or 0 for a click's. */
  round: number;
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
/** How many bursts Auto goes through before it starts over. */
const ROUNDS = 6;

const FLY = 1200;
const GONE = { dx: 0, dy: 0, alpha: 0 };
/**
 * Out along its angle, pulled down, fading as it goes, over `FLY` ms of a pass `ms` long, starting
 * `EVERY` ms later for each later round.
 */
const flying = (ms: number) =>
  patch<Spark, SparkPose>(
    ms,
    (phase, s) => {
      const t = phase * ms - s.round * EVERY;
      const q = (t < 0 ? t + ms : t) / FLY;
      if (q >= 1) return GONE;
      return {
        dx: Math.cos(s.angle) * s.speed * q,
        dy: Math.sin(s.angle) * s.speed * q + 140 * q * q,
        alpha: 1 - q * q,
      };
    },
    { writes: ['dx', 'dy', 'alpha'] },
  );
const fly = flying(FLY);
/** Every one of Auto's bursts in turn, one every `EVERY` ms. */
const rounds = flying(EVERY * ROUNDS);

const sparksAt = (x: number, y: number, round = 0): Spark[] =>
  Array.from({ length: 40 }, () => ({
    x,
    y,
    round,
    angle: Math.random() * 2 * Math.PI,
    speed: 40 + Math.random() * 90,
  }));

export default demo((d) => {
  const { root } = d;
  const canvas = document.createElement('canvas');
  canvas.className = 'burst';
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  const m = mix<Spark, SparkPose>(SPARK, d.options('burst'));
  d.closes(m);
  const bursts = new Set<{ sparks: Spark[]; handle: Handle<Spark>; at: number }>();

  // Auto is one voice looping for good over a few bursts' sparks, each round a burst later.
  const auto = Array.from({ length: ROUNDS }, (_, r) =>
    sparksAt(0.2 + 0.6 * Math.random(), HEIGHT * (0.3 + 0.3 * Math.random()), r),
  ).flat();
  bursts.add({
    sparks: auto,
    handle: m.cue({ patch: rounds, subjects: auto, loop: true }),
    at: Number.POSITIVE_INFINITY,
  });

  // One voice per click, for one pass: when it ends the voice leaves the mix. Its sparks are kept
  // while history reaches back to its pass, so a seek back finds them, and drawn while it plays.
  d.on(canvas, 'click', (e) => {
    const box = canvas.getBoundingClientRect();
    const sparks = sparksAt((e.clientX - box.left) / box.width, e.clientY - box.top);
    bursts.add({ sparks, handle: m.cue({ patch: fly, subjects: sparks }), at: m.now });
  });

  const pose = { dx: 0, dy: 0, alpha: 1 };
  d.frame(m, (now) => {
    m.sync(now);
    const width = canvas.clientWidth;
    canvas.width = width * devicePixelRatio;
    canvas.height = HEIGHT * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = getComputedStyle(root).color;
    const playing = new Set(m.voices());
    for (const b of bursts) {
      if (b.at + FLY < m.now - KEPT) bursts.delete(b);
      if (!playing.has(b.handle) || b.handle.state === 'pending') continue;
      for (const s of b.sparks) {
        m.probe(s, pose);
        if (pose.alpha <= 0) continue;
        ctx.globalAlpha = pose.alpha;
        ctx.fillRect(s.x * width + pose.dx - 2, s.y + pose.dy - 2, 4, 4);
      }
    }
  });
});
