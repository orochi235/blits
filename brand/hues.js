// The logo's hue schedule: the brand green turned to each hue in turn, each change sweeping across
// the sign. One self-contained function, so a place that can only take source (the playground's
// code fields) can embed it whole with `logoHues.toString()`.

export function logoHues() {
  const GREEN = 0xb2e81b;
  // The hues, as turns of the green in degrees.
  const TURNS = [0, 45, 150, 195, 255, 305];
  // How long each hue shows, ms; it does not divide the logo's 14 s scenes, so the two drift.
  const SHADE = 4000;
  const CYCLE = TURNS.length * SHADE;
  // How long a change takes to cross the sign, and each dot to turn; when, into a hue, it sets out.
  const SWEEP = 900;
  const TURN = 320;
  const LEAVE = SHADE - SWEEP - TURN;
  // Where each change reaches a place first, as a share of the sweep: a way of crossing per change.
  const CROSSINGS = [
    (x, _y, cols) => x / cols,
    (_x, y, _cols, rows) => 1 - y / rows,
    (x, y, cols, rows) => Math.hypot(x / cols - 0.5, (y / rows - 0.5) * (rows / cols)) * 1.9,
    (x, y) => (((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) + 1) % 1,
    (x, _y, cols) => 1 - x / cols,
    (x, y, cols, rows) => (x / cols + y / rows) / 2,
  ];
  const between = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

  /** The turn of the green, degrees, `t` ms into a pass, at `x`, `y` on a field `cols` x `rows`. */
  function hueAt(t, x, y, cols, rows) {
    const at = ((t % CYCLE) + CYCLE) % CYCLE;
    const k = Math.min(TURNS.length - 1, Math.floor(at / SHADE));
    const from = TURNS[k];
    const to = TURNS[(k + 1) % TURNS.length];
    const cross = CROSSINGS[k % CROSSINGS.length](x, y, cols, rows);
    const u = Math.min(1, Math.max(0, (at - k * SHADE - LEAVE - cross * SWEEP) / TURN));
    return from + between(from, to) * u * u * (3 - 2 * u);
  }

  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  /** The green turned by `deg` in OKLab, as 0xrrggbb. */
  function turnedHex(deg) {
    const [r, g, b] = [16, 8, 0].map((s) => lin(((GREEN >> s) & 255) / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const q = (deg * Math.PI) / 180;
    const a = A * Math.cos(q) - B * Math.sin(q);
    const bb = A * Math.sin(q) + B * Math.cos(q);
    const l2 = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
    const m2 = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
    const s2 = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
    const out = [
      4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2,
      -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2,
      -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2,
    ].map((c) => Math.round(Math.min(1, Math.max(0, gam(c))) * 255));
    return (out[0] << 16) | (out[1] << 8) | out[2];
  }

  return { GREEN, TURNS, SHADE, CYCLE, hueAt, turnedHex };
}
