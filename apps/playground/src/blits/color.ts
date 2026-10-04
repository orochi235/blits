/** A 24-bit color number as `#rrggbb`. */
export const hexOf = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
