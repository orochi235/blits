import type { DisplayType, TypeName } from '../type.js';
import { fourteen, sixteen, twentytwo } from './alpha.js';
import { bargraph, bcd, dice, tally } from './counts.js';
import { matrix } from './matrix.js';
import { nixie } from './nixie.js';
import { cistercian, kaktovik, maya, rods } from './numerals.js';
import { braille, morse, ogham, semaphore } from './scripts.js';
import { eight, half, nine, seven } from './segments.js';
import { triangles, trianglesFine } from './triangles.js';

/** Every display type, by name. */
export const TYPES: Readonly<Record<TypeName, DisplayType>> = {
  seven,
  eight,
  nine,
  half,
  fourteen,
  sixteen,
  twentytwo,
  nixie,
  cistercian,
  matrix,
  maya,
  kaktovik,
  rods,
  braille,
  ogham,
  morse,
  semaphore,
  dice,
  tally,
  bcd,
  bargraph,
  triangles,
  'triangles-fine': trianglesFine,
};
