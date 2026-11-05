import { oklab } from '@msb235/blits';

/** The brand green every hue is turned from. */
export const GREEN = 0xb2e81b;

/** The hues the logo steps through, as turns of the brand green in degrees. */
export const TURNS = [0, 45, 150, 195, 255, 305] as const;

/** How long each hue shows; it does not divide the logo's 14 s scenes, so the two drift. */
export const SHADE = 4_000;

/** One pass over every hue. */
export const CYCLE = TURNS.length * SHADE;

/** How long a change of hue takes to cross the sign, and how long each dot takes to turn. */
const SWEEP = 900;
const TURN = 320;

/** When, into each hue's `SHADE`, the change to the next one sets out. */
const LEAVE = SHADE - SWEEP - TURN;

/**
 * Where each change of hue reaches a place first, as a share of the sweep: one way of crossing for
 * each change, in turn, from a place `x`, `y` on a field `cols` x `rows`.
 */
const CROSSINGS: ((x: number, y: number, cols: number, rows: number) => number)[] = [
  (x, _y, cols) => x / cols,
  (_x, y, _cols, rows) => 1 - y / rows,
  (x, y, cols, rows) => Math.hypot(x / cols - 0.5, (y / rows - 0.5) * (rows / cols)) * 1.9,
  (x, y) => (((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) + 1) % 1,
  (x, _y, cols) => 1 - x / cols,
  (x, y, cols, rows) => (x / cols + y / rows) / 2,
];

/** The shortest turn from `from` to `to`, in degrees. */
const between = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * The logo's turn of the green, in degrees, `t` ms into a pass, at place `x`, `y` on a field
 * `cols` x `rows`: each hue holds, then the change to the next sweeps across the field.
 */
export function hueAt(t: number, x: number, y: number, cols: number, rows: number): number {
  const at = ((t % CYCLE) + CYCLE) % CYCLE;
  const k = Math.min(TURNS.length - 1, Math.floor(at / SHADE));
  const from = TURNS[k];
  const to = TURNS[(k + 1) % TURNS.length];
  const cross = CROSSINGS[k % CROSSINGS.length](x, y, cols, rows);
  const u = Math.min(1, Math.max(0, (at - k * SHADE - LEAVE - cross * SWEEP) / TURN));
  return from + between(from, to) * u * u * (3 - 2 * u);
}

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
