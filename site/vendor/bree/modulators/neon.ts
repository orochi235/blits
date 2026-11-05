import { patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import { hash, seedOf } from '../hash.js';
import { closedRank } from '../orders.js';
import { hashThreshold } from '../render/wgsl-hash.js';
import { modulator } from './modulator.js';
import { type Bound, f32, RANK, rankAt, shader } from './shader.js';

/** One loop, ms, in slots of a second that each may hold one stutter of a tube. */
const LOOP = 60_000;
const SLOT = 1000;
const SLOTS = LOOP / SLOT;
/** How long a stutter's flicker holds each state, ms. */
const FLICKER = 35;
/** Columns per tube where the spread gives every dot the same rank, as a layer's does. */
const TUBE = 6;
/** A steady tube's halo, and an out one's leftover glow. */
const HALO = 1.25;
const OUT: Partial<Pose> = { gain: 0.06, glow: 0.5 };
/** The least 32 bits of hash at which a flicker stays lit. */
const STAYS = hashThreshold(0.55);

/** A tube's pose `t` ms into the loop: humming, or out for a flicker of a stutter. */
function poseAt(t: number, tube: number, p: Bound): Partial<Pose> {
  const seed = p.seed as number;
  const bad = hash(tube, seed, 1) ** 3;
  const chance = ((p.often as number) / 60) * (SLOT / 1000) * bad;
  const now = Math.floor(t / SLOT);
  for (let j = now; j > now - 3; j--) {
    const k = ((j % SLOTS) + SLOTS) % SLOTS;
    if (hash(tube, k, seed + 2) >= chance) continue;
    const start = j * SLOT + hash(tube, k, seed + 3) * SLOT;
    const end = start + (p.length as number) * (0.6 + 0.8 * hash(tube, k, seed + 4));
    if (t < start || t >= end) continue;
    const flick = Math.floor((t - start) / FLICKER);
    if (flick === 0 || hash(tube, flick, seed + 5 + k) < 0.55) return OUT;
  }
  const hum = 1 - 0.1 * bad * hash(tube, Math.floor(t / FLICKER), seed + 6);
  return { gain: hum, glow: HALO };
}

const NEON = shader({
  params: ['often', 'length', 'seed', 'spread', 'by', 'cols'],
  wgsl: `out.gain = 1.0;
out.glow = 1.0;
if (subject.cell < 0.5) {
  let tube = i32(select(floor(subject.x / ${f32(TUBE)}), ${RANK}, params.spread > 0.5));
  let seed = i32(params.seed);
  let h = bree_hash(tube, seed, 1);
  let bad = h * h * h;
  let chance = (params.often / 60.0) * ${f32(SLOT / 1000)} * bad;
  let t = ph * ${f32(LOOP)};
  let now = i32(floor(t / ${f32(SLOT)}));
  var out_ = false;
  for (var j = now; j > now - 3; j--) {
    let k = ((j % ${SLOTS}) + ${SLOTS}) % ${SLOTS};
    if (bree_hash(tube, k, seed + 2) >= chance) { continue; }
    let start = f32(j) * ${f32(SLOT)} + bree_hash(tube, k, seed + 3) * ${f32(SLOT)};
    let end = start + params.length * (0.6 + 0.8 * bree_hash(tube, k, seed + 4));
    if (t < start || t >= end) { continue; }
    let flick = i32(floor((t - start) / ${f32(FLICKER)}));
    if (flick == 0 || bree_hash_u32(tube, flick, seed + 5 + k) < ${STAYS}u) { out_ = true; break; }
  }
  if (out_) {
    out.gain = ${f32(OUT.gain as number)};
    out.glow = ${f32(OUT.glow as number)};
  } else {
    out.gain = 1.0 - 0.1 * bad * bree_hash(tube, i32(floor(t / ${f32(FLICKER)})), seed + 6);
    out.glow = ${f32(HALO)};
  }
}`,
  at: (ph, s, p) => {
    if (s.kind === 'cell') return { gain: 1, glow: 1 };
    const tube = p.spread ? rankAt(p, s) : Math.floor(s.x / TUBE);
    return poseAt(ph * LOOP, tube, p);
  },
  writes: ['gain', 'glow'],
});

/**
 * Each rank of the spread a neon tube, mostly steady with now and then a stutter of flickers out;
 * how often a tube stutters is seeded, so a few are much worse than the rest. Where every dot
 * ranks the same, each run of six columns is a tube. Loops each minute.
 */
export const neon = modulator({
  name: 'neon',
  about:
    'Letters buzz like failing neon tubes, some worse than others, now and then flickering out.',
  params: {
    often: {
      label: 'how often',
      min: 0,
      max: 60,
      step: 1,
      value: 15,
      unit: '/min',
      about:
        'How many times a minute the worst letters stutter. Steadier letters stutter less; at 0 every letter holds.',
    },
    length: {
      label: 'how long',
      min: 40,
      max: 1500,
      step: 10,
      value: 300,
      unit: 'ms',
      about: 'How long a stutter lasts. Higher leaves a letter sputtering for longer.',
    },
    seed: {
      label: 'seed',
      min: 1,
      max: 99,
      step: 1,
      value: 1,
      about: 'Which letters are the bad ones. Change it to pick a different few.',
    },
  },
  writes: ['gain', 'glow'],
  on: 'dots',
  patch: (at, p, rank) => {
    const spread = at.board.dots.some((d) => rank(d) !== 0);
    const bound = { often: p.often, length: p.length, seed: seedOf(p.seed) };
    return patch<Subject, Pose>(
      LOOP,
      (phase, s) =>
        s.kind === 'cell'
          ? {}
          : poseAt(phase * LOOP, spread ? rank(s) : Math.floor(s.x / TUBE), bound),
      { writes: ['gain', 'glow'] },
    );
  },
  shader: (at, p, rank) => {
    if (!rank) return null;
    const spread = at.board.dots.some((d) => closedRank(rank.by, rank.cols, d) !== 0);
    return NEON(LOOP, {
      often: p.often,
      length: p.length,
      seed: seedOf(p.seed),
      spread: spread ? 1 : 0,
      ...rank,
    });
  },
});
