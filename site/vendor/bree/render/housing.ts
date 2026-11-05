import { rgb } from '../color.js';
import { HOUSING } from './bloom-params.js';

/**
 * What a sign shows round its lights: `dark` paints the housing and its sockets, `clear` leaves the
 * housing see-through but still draws the sockets, and `none` draws neither, so only lit light
 * shows over the page and an unlit dot is simply absent.
 */
export type Housing = 'dark' | 'clear' | 'none';

/** What every backend paints for a housing: its backing color, or null for none, and whether sockets show. */
export interface HousingPaint {
  readonly backing: number | null;
  readonly sockets: boolean;
  /** Paints nothing at all, so a backend can skip compositing the housing. */
  readonly blank: boolean;
}

const PAINTS: Readonly<Record<Housing, HousingPaint>> = {
  dark: { backing: HOUSING, sockets: true, blank: false },
  clear: { backing: null, sockets: true, blank: false },
  none: { backing: null, sockets: false, blank: true },
};

/** What `housing` paints. */
export const housingPaint = (housing: Housing): HousingPaint => PAINTS[housing];

/** The color a GPU clears its housing target to: the backing, opaque, or transparent black. */
export function backingRgba(paint: HousingPaint): [number, number, number, number] {
  return paint.backing === null ? [0, 0, 0, 0] : [...rgb(paint.backing), 1];
}
