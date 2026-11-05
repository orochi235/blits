import { patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import { hash } from '../hash.js';
import { modulator } from './modulator.js';
import { type Bound, shader } from './shader.js';

/** A dot's sparkle in frame `frame` of `p`: how far its hash clears `1 - share`, as a share of it. */
const litAt = (s: Subject, frame: number, p: Bound) => {
  if (s.kind === 'cell') return 0;
  const h = hash(s.x, s.y, frame);
  const below = 1 - (p.share as number);
  return h > below ? (h - below) / (p.share as number) : 0;
};

/**
 * In WGSL the threshold is `floor(below · 2^32)` in two 16-bit halves, so the test runs on the
 * hash's 32 bits as TS's does; past 2^32 nothing sparkles.
 */
const SPARKLE = shader({
  params: ['frames', 'share', 'hi', 'lo', 'frac', 'scale'],
  wgsl: `out.lit = 0.0;
if (subject.cell < 0.5 && params.hi < 65536.0) {
  let h = bree_hash_u32(i32(subject.x), i32(subject.y), i32(floor(ph * params.frames)));
  let b = (u32(params.hi) << 16u) | u32(params.lo);
  if (h > b) { out.lit = (f32(h - b) - params.frac) * params.scale; }
}`,
  at: (ph, s, p) => ({ lit: litAt(s, Math.floor(ph * (p.frames as number)), p) }),
  writes: ['lit'],
});

/** Stray dots lighting for a moment, from a hash of where and when. Loops; ignores the order. */
export const sparkle = modulator({
  name: 'sparkle',
  about: 'Stray dots light for a moment at random.',
  params: {
    share: {
      label: 'lit at once',
      min: 0,
      max: 0.1,
      step: 0.001,
      value: 0.0067,
      unit: '%',
      scale: 100,
      about: 'What share of the dots is sparkling at any moment. Higher makes more sparkles.',
    },
    frame: {
      label: 'twinkle',
      min: 10,
      max: 500,
      step: 5,
      value: 50,
      unit: 'ms',
      about: 'How long each sparkle lasts before new ones are picked. Higher twinkles more slowly.',
    },
  },
  writes: ['lit'],
  on: 'dots',
  patch: (_at, p) => {
    const frames = Math.max(1, Math.round(1000 / p.frame));
    const bound = { share: p.share };
    return patch<Subject, Pose>(
      frames * p.frame,
      (phase, s) => ({ lit: litAt(s, Math.floor(phase * frames), bound) }),
      { writes: ['lit'] },
    );
  },
  shader: (_at, p) => {
    const frames = Math.max(1, Math.round(1000 / p.frame));
    const cut = (1 - p.share) * 2 ** 32;
    const b = Math.floor(cut);
    return SPARKLE(frames * p.frame, {
      frames,
      share: p.share,
      hi: Math.floor(b / 65536),
      lo: b % 65536,
      frac: cut - b,
      scale: 1 / (p.share * 2 ** 32),
    });
  },
});
