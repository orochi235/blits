import { aurora } from './aurora.js';
import { chase } from './chase.js';
import { palette, twoColor } from './color.js';
import { desaturate, dim, flare } from './ease.js';
import { fire } from './fire.js';
import { flash } from './flash.js';
import { glitch } from './glitch.js';
import { gradient } from './gradient.js';
import { invert } from './invert.js';
import type { Modulator } from './modulator.js';
import { neon } from './neon.js';
import { scanline } from './scanline.js';
import { shimmer } from './shimmer.js';
import { sparkle } from './sparkle.js';
import { bloom, hueCycle, pulse } from './wave.js';

export * from './modulator.js';
export {
  aurora,
  bloom,
  chase,
  desaturate,
  dim,
  fire,
  flare,
  flash,
  glitch,
  gradient,
  hueCycle,
  invert,
  neon,
  palette,
  pulse,
  scanline,
  shimmer,
  sparkle,
  twoColor,
};

const modulators = {
  flash,
  pulse,
  dim,
  'hue-cycle': hueCycle,
  palette,
  'two-color': twoColor,
  desaturate,
  bloom,
  flare,
  sparkle,
  chase,
  invert,
  scanline,
  fire,
  glitch,
  neon,
  shimmer,
  aurora,
  gradient,
};
export type ModulatorName = keyof typeof modulators;
/** Every modulator, by name. */
export const MODULATORS: Readonly<Record<ModulatorName, Modulator>> = modulators;
