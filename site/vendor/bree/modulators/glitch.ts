import { patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import { hash, seedOf } from '../hash.js';
import { modulator } from './modulator.js';
import { type Bound, f32, shader } from './shader.js';

const FRAME = 50;
/** One loop, ms: a minute, so `often` counts bursts in it. */
const LOOP = 60_000;
/** Frames per chance of a burst; a burst lasts one to three of them. */
const SLOT = 5;
const SLOTS = LOOP / FRAME / SLOT;
const CALM: Partial<Pose> = { hue: 0, gain: 1, invert: 0 };

const FRAMES = LOOP / FRAME;

/** What a glitch reads on a board `cols` wide. */
const boundOf = (cols: number, p: { often: number; strength: number; seed: number }) => ({
  cols,
  strength: p.strength,
  seed: seedOf(p.seed),
  chance: p.often / SLOTS,
});

/** A dot's pose in frame `f` of the loop: calm, or torn by a burst's band. */
function poseAt(f: number, x: number, y: number, p: Bound): Partial<Pose> {
  const seed = p.seed as number;
  const strength = p.strength as number;
  const cols = p.cols as number;
  const slot = Math.floor(f / SLOT);
  if (hash(slot, seed, 1) >= (p.chance as number)) return CALM;
  const len = 1 + Math.floor(hash(slot, seed, 2) * 3);
  const from = Math.floor(hash(slot, seed, 3) * (SLOT - len + 1));
  const k = f - slot * SLOT - from;
  if (k < 0 || k >= len) return CALM;
  const tall = 1 + Math.floor(hash(f, seed, 4) * 3);
  const band = Math.floor((y + Math.floor(hash(f, seed, 5) * tall)) / tall);
  const roll = (n: number) => hash(band, f, seed + n);
  if (roll(10) >= 0.3 + 0.5 * strength) return CALM;
  const start = roll(11) * cols * 0.7;
  if (x < start || x > start + cols * (0.3 + 0.7 * roll(12))) return CALM;
  const turn = (roll(13) < 0.5 ? -1 : 1) * (50 + 130 * strength);
  const mode = roll(14);
  return {
    hue: turn,
    gain: mode < 0.3 * strength ? 0 : 1,
    invert: mode >= 0.3 * strength && mode < 0.6 * strength ? 1 : 0,
  };
}

const GLITCH = shader({
  params: ['cols', 'strength', 'seed', 'chance'],
  wgsl: `out.hue = 0.0;
out.gain = 1.0;
out.invert = 0.0;
let seed = i32(params.seed);
let f = i32(floor(ph * ${f32(FRAMES)}));
let slot = f / ${SLOT};
let len = 1 + i32(floor(bree_hash(slot, seed, 2) * 3.0));
let first = i32(floor(bree_hash(slot, seed, 3) * f32(${SLOT} - len + 1)));
let k = f - slot * ${SLOT} - first;
let tall = 1 + i32(floor(bree_hash(f, seed, 4) * 3.0));
let band = i32(floor(f32(i32(subject.y) + i32(floor(bree_hash(f, seed, 5) * f32(tall)))) / f32(tall)));
let start = bree_hash(band, f, seed + 11) * params.cols * 0.7;
if (subject.cell < 0.5 && bree_hash(slot, seed, 1) < params.chance && k >= 0 && k < len
    && bree_hash(band, f, seed + 10) < 0.3 + 0.5 * params.strength
    && !(subject.x < start || subject.x > start + params.cols * (0.3 + 0.7 * bree_hash(band, f, seed + 12)))) {
  out.hue = select(1.0, -1.0, bree_hash(band, f, seed + 13) < 0.5) * (50.0 + 130.0 * params.strength);
  let mode = bree_hash(band, f, seed + 14);
  out.gain = select(1.0, 0.0, mode < 0.3 * params.strength);
  out.invert = select(0.0, 1.0, mode >= 0.3 * params.strength && mode < 0.6 * params.strength);
}`,
  at: (ph, s, p) => (s.kind === 'cell' ? CALM : poseAt(Math.floor(ph * FRAMES), s.x, s.y, p)),
  writes: ['hue', 'gain', 'invert'],
});

/**
 * Rare bursts a frame or a few long in which bands of rows, each over a stretch of columns, turn
 * hard round the hue and some drop out or invert. Seeded; loops each minute; ignores the order.
 */
export const glitch = modulator({
  name: 'glitch',
  about: 'Now and then bands of rows tear: their color jumps, and some drop out or flip.',
  params: {
    often: {
      label: 'how often',
      min: 1,
      max: 120,
      step: 1,
      value: 10,
      unit: '/min',
      about: 'About how many bursts there are a minute. Higher glitches more.',
    },
    strength: {
      label: 'how strong',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.7,
      about:
        'How hard a burst hits: how far its bands turn the color, how many rows it catches, and how many drop out or flip. Higher is harsher.',
    },
    seed: {
      label: 'seed',
      min: 1,
      max: 99,
      step: 1,
      value: 1,
      about: 'Which run of bursts plays. Change it for a different pattern of glitches.',
    },
  },
  writes: ['hue', 'gain', 'invert'],
  on: 'dots',
  patch: (at, p) => {
    const bound = boundOf(at.board.cols, p);
    return patch<Subject, Pose>(
      LOOP,
      (phase, s) => (s.kind === 'cell' ? {} : poseAt(Math.floor(phase * FRAMES), s.x, s.y, bound)),
      { writes: ['hue', 'gain', 'invert'] },
    );
  },
  shader: (at, p) => GLITCH(LOOP, boundOf(at.board.cols, p)),
});
