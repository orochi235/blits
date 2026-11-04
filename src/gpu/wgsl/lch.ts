/**
 * `lerpLch` in `color.ts`, with `lchPair` and `shortWay` from `lch.ts`: two OKLab colors with
 * coverage interpolated in OKLCH, hue the short way, a gray end taking the other's hue. The held
 * form keeps each end past it, as a stack's `lerp` in `stacked-modes.ts` does.
 */
export const LERP_LCH_WGSL = /* wgsl */ `
fn blits_hue(a: f32, b: f32) -> f32 {
  if (a == 0.0 && b == 0.0) { return 0.0; }
  return atan2(b, a);
}

fn blits_lerp_lch(x: array<f32, 4>, y: array<f32, 4>, u: f32) -> array<f32, 4> {
  let xw = x[3];
  let yw = y[3];
  var ys = 0.0;
  if (yw > 0.0) { ys = 1.0 / yw; }
  let yL = y[0] * ys;
  let yA = y[1] * ys;
  let yB = y[2] * ys;
  var xL = yL;
  var xA = yA;
  var xB = yB;
  if (xw > 0.0) { let xs = 1.0 / xw; xL = x[0] * xs; xA = x[1] * xs; xB = x[2] * xs; }
  var tL = xL;
  var tA = xA;
  var tB = xB;
  if (yw > 0.0) { tL = yL; tA = yA; tB = yB; }
  let xc = sqrt(xA * xA + xB * xB);
  let yc = sqrt(tA * tA + tB * tB);
  let ah = blits_hue(xA, xB);
  let bh = blits_hue(tA, tB);
  let h0 = select(ah, bh, xc < 1e-4);
  let to = select(bh, ah, yc < 1e-4);
  var turn = to - h0;
  if (turn > 3.14159265) { turn -= 6.2831853; } else if (turn < -3.14159265) { turn += 6.2831853; }
  let w = xw + (yw - xw) * u;
  let C = xc + (yc - xc) * u;
  let h = h0 + turn * u;
  return array<f32, 4>((xL + (tL - xL) * u) * w, C * cos(h) * w, C * sin(h) * w, w);
}

fn blits_lerp_lch_held(x: array<f32, 4>, y: array<f32, 4>, u: f32) -> array<f32, 4> {
  if (u <= 0.0) { return x; }
  if (u >= 1.0) { return y; }
  return blits_lerp_lch(x, y, u);
}
`;
