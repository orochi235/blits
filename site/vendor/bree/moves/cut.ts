import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import { litAt, move, on } from './move.js';
import { LIT, litOf, moveShader } from './shader.js';

const CUT_MS = 1;

const STAND = moveShader({
  params: ['left'],
  wgsl: `lit = ${LIT('params.left')};`,
  at: (_phase, d, p, t) => litOf(t, d, p.left as number),
});

/** The message shown in the pass's second half where `on` is 1, its first half where it is 0. */
const CUT = moveShader({
  params: ['left', 'on'],
  wgsl: `lit = select(0.0, ${LIT('params.left')}, (phase >= 0.5) == (params.on > 0.5));`,
  at: (phase, d, p, t) =>
    phase >= 0.5 === (p.on as number) > 0.5 ? litOf(t, d, p.left as number) : 0,
});

/** A dot switches on; an order spreads the switching into a wipe. */
export const cutOn = move({
  name: 'cut-on',
  about: 'Dots switch on to the message at once.',
  slot: 'enter',
  params: {},
  patch: (at) =>
    patch<Led, Pose>(CUT_MS, (phase, led) => on(phase >= 0.5 && litAt(at, led)), {
      writes: ['lit'],
    }),
  shader: (at) => CUT(at, CUT_MS, { left: at.left, on: 1 }),
});

/** A dot switches off. */
export const cutOff = move({
  name: 'cut-off',
  about: 'Dots switch off at once.',
  slot: 'exit',
  params: {},
  patch: (at) =>
    patch<Led, Pose>(CUT_MS, (phase, led) => on(phase < 0.5 && litAt(at, led)), {
      writes: ['lit'],
    }),
  shader: (at) => CUT(at, CUT_MS, { left: at.left, on: 0 }),
});

/** The message standing still. */
export const stand = move({
  name: 'stand',
  about: 'The message stands still.',
  slot: 'active',
  params: {
    ms: {
      label: 'length',
      min: 100,
      max: 10000,
      step: 100,
      value: 1000,
      unit: 'ms',
      about: 'How long the message stands still.',
    },
  },
  patch: (at, p) => patch<Led, Pose>(p.ms, (_, led) => on(litAt(at, led)), { writes: ['lit'] }),
  shader: (at, p) => STAND(at, p.ms, { left: at.left }),
});
