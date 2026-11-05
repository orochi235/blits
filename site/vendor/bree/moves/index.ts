import { bounceIn } from './bounce.js';
import { cutOff, cutOn, stand } from './cut.js';
import { dropIn, dropOut } from './drop.js';
import { fold, tumble, unfold } from './fold.js';
import { melt } from './melt.js';
import type { Move } from './move.js';
import { rainIn, rainOut } from './rain.js';
import { reelIn, rollAway } from './reel.js';
import { scrollAcross, scrollIn, scrollOut } from './scroll.js';
import { splitIn, splitOut } from './split.js';
import { assemble, scatter } from './swarm.js';
import { tile } from './tile.js';
import { typeOff, typeOn } from './type.js';
import { wave } from './wave.js';

export * from './move.js';
export {
  assemble,
  bounceIn,
  cutOff,
  cutOn,
  dropIn,
  dropOut,
  fold,
  melt,
  rainIn,
  rainOut,
  reelIn,
  rollAway,
  scatter,
  scrollAcross,
  scrollIn,
  scrollOut,
  splitIn,
  splitOut,
  stand,
  tile,
  tumble,
  typeOff,
  typeOn,
  unfold,
  wave,
};

const moves = {
  'cut-on': cutOn,
  'cut-off': cutOff,
  stand,
  unfold,
  fold,
  tumble,
  'drop-in': dropIn,
  'drop-out': dropOut,
  'reel-in': reelIn,
  'roll-away': rollAway,
  'rain-in': rainIn,
  'rain-out': rainOut,
  'scroll-in': scrollIn,
  'scroll-out': scrollOut,
  'scroll-across': scrollAcross,
  tile,
  'type-on': typeOn,
  'type-off': typeOff,
  assemble,
  scatter,
  'bounce-in': bounceIn,
  wave,
  melt,
  'split-in': splitIn,
  'split-out': splitOut,
};
export type MoveName = keyof typeof moves;
/** Every move, by name. */
export const MOVES: Readonly<Record<MoveName, Move>> = moves;
