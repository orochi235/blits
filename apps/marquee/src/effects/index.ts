import { chase } from './chase';
import type { Layer, TextEffect } from './effect';
import { fall } from './fall';
import { flip } from './flip';
import { hold } from './hold';
import { rainbow } from './rainbow';
import { roll } from './roll';
import { scroll } from './scroll';
import { sparkle } from './sparkle';
import { tile } from './tile';

export * from './effect';
export { chase, fall, flip, hold, rainbow, roll, scroll, sparkle, tile };

const text = { hold, scroll, flip, roll, fall, tile };
const layers = { sparkle, chase, rainbow };
export type TextName = keyof typeof text;
export type LayerName = keyof typeof layers;
/** Every text effect, by name. */
export const TEXT: Readonly<Record<TextName, TextEffect>> = text;
/** Every layer, by name. */
export const LAYERS: Readonly<Record<LayerName, Layer>> = layers;
