import { level, oklab } from '@msb235/blits';

/** The brand green every hue is turned from. */
export const GREEN = 0xb2e81b;

/** The hues the logo steps through, as turns of the brand green in degrees. */
export const TURNS = [0, 45, 150, 195, 255, 305] as const;

/** How long each hue shows, chosen not to divide the logo's 14 s scenes, so the two drift. */
export const SHADE = 4_300;

/** One pass over every hue. */
export const CYCLE = TURNS.length * SHADE;

/**
 * How much the logo is showing each hue, 0 to 1, set by the logo every frame; any mix may weigh a
 * voice by one. Before the logo plays, it is showing the green.
 */
export const showing = TURNS.map((_, k) => level<unknown>(k === 0 ? 1 : 0));

/** The brand green turned by `deg`, in OKLab at full coverage, as `oklab` gives a color. */
export function turned(deg: number): number[] {
  const [L = 0, a = 0, b = 0] = oklab(GREEN);
  const r = (deg * Math.PI) / 180;
  return [L, a * Math.cos(r) - b * Math.sin(r), a * Math.sin(r) + b * Math.cos(r), 1];
}

/** The shortest turn from `from` to `to`, in degrees. */
export const between = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;
