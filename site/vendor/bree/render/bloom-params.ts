/** How a light blooms, shared by every renderer. */
export const BLOOM = {
  /** Blur radius in pitches, multiplied by `lamps.glow`. */
  spread: 0.9,
} as const;

/** The housing behind the lights. */
export const HOUSING = 0x0d0a08;
/** The socket a dot sits in. */
export const DOT_COLOR = 0x21150f;
/** The socket a border bulb sits in. */
export const BULB_COLOR = 0x2b2118;
/** The dark segment an unlit segment shows. */
export const SEGMENT_COLOR = 0x1c130d;
/** An unlit Nixie cathode: dull wire. */
export const WIRE_COLOR = 0x3a2c22;
/** A readout's faceplate. */
export const PLATE_COLOR = 0x120d0a;
