import { type Kit, mul, sum } from '@msb235/blits';

/** The parameters a stock Tone node has that blits-tone drives by default, in their own units. */
export interface Levels {
  /** Cents, added to the node's detune. */
  detune: number;
  /** Decibels, added to the node's volume. */
  volume: number;
  /** A factor on a `Gain` node's gain. */
  gain: number;
}

/** blits-tone's channels, to spread into a kit: `kit({ ...channels, brightness: sum() })`. */
export const channels: Kit<Levels> = { detune: sum(), volume: sum(), gain: mul() };
