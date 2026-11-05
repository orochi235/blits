import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import { clearAbove, move, movedAt, on } from './move.js';
import { type Lookup, MOVED, movedOf, moveShader, ROUND } from './shader.js';

/** How high each bounce rises against the one before. */
const REBOUND = 0.4;

/** Each bounce's height, how long the fall and each bounce take, and how long all of them take. */
function hopsOf(height: number, bounces: number) {
  // A bounce rises at least a row, so the last one still shows.
  const heights = Array.from({ length: bounces }, (_, k) =>
    Math.max(1, height * REBOUND ** (k + 1)),
  );
  // Under gravity, falling from h takes time in proportion to √h; a bounce rises and falls.
  const legs = [Math.sqrt(height), ...heights.map((h) => 2 * Math.sqrt(h))];
  const total = legs.reduce((a, b) => a + b, 0);
  return { heights, legs, total };
}

/**
 * `bounced` reading the fall's height and length and each bounce's from `hops`, a row each, and
 * the message moved up that far as bounce-in draws it.
 */
const BOUNCE = moveShader({
  params: ['left', 'total', 'hopCount'],
  wgsl: `var t = phase * params.total;
var above = 0.0;
for (var k = 0.0; k < params.hopCount; k += 1.0) {
  let h = table_hops(0.0, k);
  let leg = table_hops(1.0, k);
  if (t < leg) {
    let u = select((2.0 * t) / leg - 1.0, t / leg, k < 0.5);
    above = h * (1.0 - u * u);
    break;
  }
  t -= leg;
}
lit = ${MOVED('params.left', `-${ROUND('above')}`)};`,
  at(phase, d, p, tables) {
    const hops = tables.hops as Lookup;
    let t = phase * (p.total as number);
    let above = 0;
    for (let k = 0; k < (p.hopCount as number); k++) {
      const [h, leg] = [hops(0, k), hops(1, k)];
      if (t < leg) {
        const u = k === 0 ? t / leg : (2 * t) / leg - 1;
        above = h * (1 - u * u);
        break;
      }
      t -= leg;
    }
    return movedOf(tables, d, p.left as number, -Math.round(above));
  },
});

/**
 * How far above its place the message is, in rows, `phase` of the way through a fall from
 * `height` and `bounces` rebounds, each a parabola and each lower than the last.
 */
export function bounced(height: number, bounces: number) {
  const { heights, legs, total } = hopsOf(height, bounces);
  return (phase: number) => {
    let t = phase * total;
    const [fall = 0] = legs;
    if (t < fall) return height * (1 - (t / fall) ** 2);
    t -= fall;
    for (const [k, h] of heights.entries()) {
      const leg = legs[k + 1] as number;
      if (t < leg) {
        const u = (2 * t) / leg - 1;
        return h * (1 - u * u);
      }
      t -= leg;
    }
    return 0;
  };
}

/** The message dropping in from above the sign and bouncing to rest. */
export const bounceIn = move({
  name: 'bounce-in',
  about: 'The message drops in from above and bounces to rest, each bounce lower than the last.',
  slot: 'enter',
  params: {
    ms: {
      label: 'bounce time',
      min: 300,
      max: 4000,
      step: 50,
      value: 1300,
      unit: 'ms',
      about: 'How long the fall and every bounce take together. Higher bounces more slowly.',
    },
    bounces: {
      label: 'bounces',
      min: 0,
      max: 5,
      step: 1,
      value: 3,
      about: 'How many times the message bounces before it rests. At 0 it lands dead.',
    },
  },
  patch(at, p) {
    const above = bounced(clearAbove(at), p.bounces);
    return patch<Led, Pose>(p.ms, (phase, led) => on(movedAt(at, led, -Math.round(above(phase)))), {
      writes: ['lit'],
    });
  },
  shader(at, p) {
    const height = clearAbove(at);
    const { heights, legs, total } = hopsOf(height, p.bounces);
    const hops = [height, ...heights].flatMap((h, k) => [h, legs[k] as number]);
    return BOUNCE(
      at,
      p.ms,
      { left: at.left, total, hopCount: legs.length },
      { hops: { width: 2, height: legs.length, data: hops } },
    );
  },
});
