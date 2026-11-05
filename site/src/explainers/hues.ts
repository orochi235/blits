import { logoHues } from '@brand/hues.js';
import { oklab } from '@msb235/blits';

/** The logo's hue schedule, defined once in the brand folder, where the playground reads it too. */
export const { GREEN, TURNS, SHADE, CYCLE, hueAt } = logoHues();

/** The brand green turned by `deg`, in OKLab at full coverage, as `oklab` gives a color. */
export function turned(deg: number): number[] {
  const [L = 0, a = 0, b = 0] = oklab(GREEN);
  const r = (deg * Math.PI) / 180;
  return [L, a * Math.cos(r) - b * Math.sin(r), a * Math.sin(r) + b * Math.cos(r), 1];
}

let logo: () => number = () => 0;
let steer: (() => number) | null = null;

/** How far into a pass of its hues the logo is, ms: where another mix starts, to play in step. */
export const logoAt = (): number => logo();

/** Called by the logo with how it reads its place in the pass. */
export function followLogo(at: () => number): void {
  logo = at;
}

/**
 * Hands the logo's hues to another clock: while set, the logo seeks its hue voice to `to()` ms into
 * the pass every frame, and once cleared with null it plays on from there.
 */
export function steerLogo(to: (() => number) | null): void {
  steer = to;
}

/** Where whatever is steering the logo's hues wants them, or null while nothing is. */
export const steered = (): number | null => steer?.() ?? null;
