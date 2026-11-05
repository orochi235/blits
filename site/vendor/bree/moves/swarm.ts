import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import { hash } from '../hash.js';
import type { Placed } from '../orders.js';
import type { Values } from '../params.js';
import { litAt, move, on } from './move.js';

const SWARM_PARAMS = {
  ms: {
    label: 'fly time',
    min: 300,
    max: 5000,
    step: 50,
    value: 1400,
    unit: 'ms',
    about:
      'How long the dots take to fly between the scatter and the message. Higher flies more slowly.',
  },
  reach: {
    label: 'spread',
    min: 0.05,
    max: 1,
    step: 0.05,
    value: 0.7,
    scale: 100,
    unit: '%',
    about:
      'How far from its place each dot is scattered, as a share of the way to a random spot on or just off the sign.',
  },
  swirl: {
    label: 'swirl',
    min: -1,
    max: 1,
    step: 0.05,
    value: 0.25,
    unit: 'turns',
    about:
      'How far the dots wheel around their places as they fly. At 0 they fly straight; negative wheels the other way.',
  },
  seed: {
    label: 'seed',
    min: 1,
    max: 99,
    step: 1,
    value: 1,
    about: 'Which scatter the dots fly from or to. Each number is a different one.',
  },
} as const;
type Swarm = Values<typeof SWARM_PARAMS>;

/** How much of a pass the dots' start times spread over. */
const STAGGER = 0.5;
/** How much of its flight a dot takes to light up from nothing. */
const FADE = 0.15;
/** How brightly a dot shows in flight, far from its place, against its own level landed. */
const AFLOAT = 0.35;
const easeOut = (u: number) => 1 - (1 - u) ** 3;

/**
 * The message's dots `phase` of the way from a seeded scatter to their places, each starting a
 * little after or before the next and lighting up as it leaves: one frame per phase, cached since
 * every dot of the sign asks for the same one.
 */
function swarm(at: Placed, p: Swarm) {
  const { cols, rows } = at.board;
  const dots = at.board.dots.flatMap((led, i) => {
    const level = litAt(at, led);
    if (level <= 0) return [];
    const r = (k: number) => hash(i, p.seed, k);
    const sx = led.x + p.reach * (-2 + r(1) * (cols + 4) - led.x);
    const sy = led.y + p.reach * (-2 + r(2) * (rows + 4) - led.y);
    return [{ x: led.x, y: led.y, dx: sx - led.x, dy: sy - led.y, level, delay: STAGGER * r(3) }];
  });
  // Wheeling in a space as tall as it is wide, so a turn stays on a long, low sign.
  const aspect = rows / Math.max(1, cols);
  const frames = new Map<number, Float32Array>();
  const frame = (phase: number) => {
    let f = frames.get(phase);
    if (f) return f;
    f = new Float32Array(cols * rows);
    for (const d of dots) {
      const u = Math.min(1, Math.max(0, (phase - d.delay) / (1 - STAGGER)));
      if (u <= 0) continue;
      const left = 1 - easeOut(u);
      const a = 2 * Math.PI * p.swirl * left;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const ox = left * (d.dx * c - (d.dy / aspect) * s);
      const oy = left * (d.dx * aspect * s + d.dy * c);
      const x = Math.round(d.x + ox);
      const y = Math.round(d.y + oy);
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      const k = y * cols + x;
      // Dim in flight and brightening as they land, so the message sharpens out of the haze.
      const glow = Math.min(1, u / FADE) * (AFLOAT + (1 - AFLOAT) * (1 - left) ** 2);
      f[k] = Math.max(f[k] as number, d.level * glow);
    }
    if (frames.size > 256) frames.clear();
    frames.set(phase, f);
    return f;
  };
  return (phase: number, led: Led) =>
    on(led.kind === 'dot' ? (frame(phase)[led.y * cols + led.x] ?? 0) : 0);
}

/** Every lit dot flying in from a scatter to its place. */
export const assemble = move({
  name: 'assemble',
  about: 'Every lit dot flies in from a random scatter to its place, slowing as it lands.',
  slot: 'enter',
  params: SWARM_PARAMS,
  patch(at, p) {
    const draw = swarm(at, p);
    return patch<Led, Pose>(p.ms, draw, { writes: ['lit'] });
  },
});

/** Every lit dot flying out from its place to a scatter. */
export const scatter = move({
  name: 'scatter',
  about: 'Every lit dot flies off from its place to a random scatter, speeding up as it goes.',
  slot: 'exit',
  params: SWARM_PARAMS,
  patch(at, p) {
    const draw = swarm(at, p);
    return patch<Led, Pose>(p.ms, (phase, led) => draw(1 - phase, led), { writes: ['lit'] });
  },
});
