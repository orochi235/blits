/**
 * `blits_ease(at, u)`: evaluates the curve packed by `curveData` at `values[at .. at + 5]`, a
 * `linear` easing's points where its head says, as `bezier`, `steps` and `linear` in
 * `src/easing.ts` do. Needs `values: array<f32>` in scope. The f32 limits
 * (Newton to 1e-6, bisection capped at 24 steps) are what f32 can reach.
 */
export const EASING_WGSL = /* wgsl */ `
fn blits_bezier(at: u32, u: f32) -> f32 {
  if (u <= 0.0) { return 0.0; }
  if (u >= 1.0) { return 1.0; }
  let x1 = values[at + 1u];
  let y1 = values[at + 2u];
  let x2 = values[at + 3u];
  let y2 = values[at + 4u];
  let cx = 3.0 * x1;
  let bx = 3.0 * (x2 - x1) - cx;
  let ax = 1.0 - cx - bx;
  let cy = 3.0 * y1;
  let by = 3.0 * (y2 - y1) - cy;
  let ay = 1.0 - cy - by;
  var t = u;
  for (var i = 0; i < 8; i++) {
    let err = ((ax * t + bx) * t + cx) * t - u;
    if (abs(err) < 1e-6) { return ((ay * t + by) * t + cy) * t; }
    let d = (3.0 * ax * t + 2.0 * bx) * t + cx;
    if (abs(d) < 1e-6) { break; }
    t -= err / d;
  }
  var lo = 0.0;
  var hi = 1.0;
  t = u;
  for (var i = 0; i < 24; i++) {
    if (hi - lo <= 1e-6) { break; }
    if (((ax * t + bx) * t + cx) * t < u) { lo = t; } else { hi = t; }
    t = (lo + hi) * 0.5;
  }
  return ((ay * t + by) * t + cy) * t;
}

fn blits_ease_points(at: u32, u: f32) -> f32 {
  let p = at + u32(values[at + 1u]);
  let n = u32(values[at + 2u]);
  var hit = -1;
  var below = -1;
  for (var i = 0u; i < n; i++) {
    let x = values[p + 2u * i];
    if (x == u) { hit = i32(i); }
    if (x < u) { below = i32(i); }
  }
  if (hit >= 0) { return values[p + 2u * u32(hit) + 1u]; }
  let a = u32(min(max(below, 0), i32(n) - 2));
  let ax = values[p + 2u * a];
  let ay = values[p + 2u * a + 1u];
  let bx = values[p + 2u * a + 2u];
  let by = values[p + 2u * a + 3u];
  if (ax == bx) { return by; }
  return ay + (by - ay) * ((u - ax) / (bx - ax));
}

fn blits_ease(at: u32, u: f32) -> f32 {
  let kind = u32(values[at]);
  if (kind == 1u) { return blits_bezier(at, u); }
  if (kind == 2u) {
    let n = values[at + 1u];
    let jumps = n + values[at + 3u];
    let c = clamp(u, 0.0, 1.0);
    return min(jumps, floor(c * n) + values[at + 2u]) / jumps;
  }
  if (kind == 3u) { return blits_ease_points(at, u); }
  return u;
}
`;
