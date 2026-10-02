import { type Channel, mul, sum, vec } from '@msb235/blits';

/** The pose fields the driver reads. A host's kit holds any of them, and fields of its own. */
export interface Emission {
  /** Particles per second the driver emits at the subject. */
  rate: number;
  /** Scales the system's authored `startSpeed`. */
  speed: number;
  /** Scales the system's authored `startSize`. */
  size: number;
  /** Scales the system's authored `startLife`. */
  life: number;
  /** Scales the system's authored `startColor`, per component. */
  tint: number[];
  /** Added to the subject's position. */
  offset: number[];
}

/** The driver's channels, to spread into a kit: `kit({ ...channels, heat: max() })`. */
export const channels: { readonly [K in keyof Emission]: Channel<Emission[K]> } = {
  rate: sum(),
  speed: mul(),
  size: mul(),
  life: mul(),
  tint: vec(4, mul()),
  offset: vec(3, sum()),
};
