import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import type { Placed } from '../orders.js';
import { litAt, move, on } from './move.js';
import { LIT, litOf, moveShader, ROUND } from './shader.js';

/** How far a dot falls from or to: past the text's top or bottom. */
const fall = (at: Placed) => at.text.rows + 1;

/** The message `drop` rows from falling in (`out` 0) or out (`out` 1), as dropIn and dropOut move it. */
const DROP = moveShader({
  params: ['left', 'drop', 'out'],
  wgsl: `let ph2 = phase * phase;
let dy = ${ROUND('select(-params.drop * (1.0 - ph2), params.drop * ph2, params.out > 0.5)')};
lit = ${LIT('params.left', 'dy')};`,
  at(phase, d, p, t) {
    const drop = p.drop as number;
    const dy = Math.round(p.out ? drop * phase ** 2 : -drop * (1 - phase ** 2));
    return litOf(t, d, p.left as number, dy);
  },
});

const DROP_PARAM = {
  label: 'drop time',
  min: 100,
  max: 1500,
  step: 25,
  value: 350,
  unit: 'ms',
  about: 'How long the fall takes. Higher drops more slowly.',
};

/** The message dropping in from above, speeding up as it comes. */
export const dropIn = move({
  name: 'drop-in',
  about: 'The message drops in from above.',
  slot: 'enter',
  params: { ms: DROP_PARAM },
  patch(at, p) {
    const drop = fall(at);
    return patch<Led, Pose>(
      p.ms,
      (phase, led) => on(litAt(at, led, 0, Math.round(-drop * (1 - phase ** 2)))),
      { writes: ['lit'] },
    );
  },
  shader: (at, p) => DROP(at, p.ms, { left: at.left, drop: fall(at), out: 0 }),
});

/** The message falling out of the bottom under gravity. */
export const dropOut = move({
  name: 'drop-out',
  about: 'The message falls out the bottom.',
  slot: 'exit',
  params: { ms: DROP_PARAM },
  patch(at, p) {
    const drop = fall(at);
    return patch<Led, Pose>(
      p.ms,
      (phase, led) => on(litAt(at, led, 0, Math.round(drop * phase ** 2))),
      { writes: ['lit'] },
    );
  },
  shader: (at, p) => DROP(at, p.ms, { left: at.left, drop: fall(at), out: 1 }),
});
