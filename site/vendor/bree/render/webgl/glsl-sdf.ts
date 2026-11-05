import { ENDS, PRIM, TRI_FILL } from '../prims.js';

/** Texels per row of the data textures; an item past a row's end wraps to the next. */
export const ROW = 1024;

/** `sdf` in `prims.ts`, in GLSL: a primitive's distance in local units, below 0 inside. */
export const SDF_GLSL = `
uniform highp sampler2D u_points;
float seg_dist(vec2 p, vec2 a, vec2 b) {
  vec2 d = b - a;
  float len = dot(d, d);
  float t = len > 0.0 ? clamp(dot(p - a, d) / len, 0.0, 1.0) : 0.0;
  return length(p - a - d * t);
}
vec2 point_at(int i) { return texelFetch(u_points, ivec2(i % ${ROW}, i / ${ROW}), 0).xy; }
float bar_dist(vec2 p, vec4 ends, float hw, float style) {
  if (style == ${ENDS.round}.0) { return seg_dist(p, ends.xy, ends.zw) - hw; }
  vec2 c = (ends.xy + ends.zw) * 0.5;
  float len = length(ends.zw - ends.xy);
  vec2 u = len > 0.0 ? (ends.zw - ends.xy) / len : vec2(1.0, 0.0);
  float along = abs(dot(p - c, u));
  float across = abs(dot(p - c, vec2(-u.y, u.x)));
  float half_len = len * 0.5;
  if (style == ${ENDS.square}.0) {
    vec2 q = vec2(along - half_len, across - hw);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }
  return max(across - hw, (along + across - (half_len + hw)) * 0.7071067811865476);
}
float tri_inradius(vec4 g0, vec4 g1) {
  vec2 a = g0.xy, b = g0.zw, c = g1.xy;
  float area = abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5;
  float perimeter = length(b - a) + length(c - b) + length(a - c);
  return perimeter > 0.0 ? 2.0 * area / perimeter : 0.0;
}
float tri_dist(vec2 p, vec2 a, vec2 b, vec2 c) {
  float d = min(seg_dist(p, a, b), min(seg_dist(p, b, c), seg_dist(p, c, a)));
  float s1 = sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  float s2 = sign((c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x));
  float s3 = sign((a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x));
  return abs(s1 + s2 + s3) == 3.0 ? -d : d;
}
float prim_dist(int kind, vec4 g0, vec4 g1, vec2 p, float r) {
  if (kind == ${PRIM.tri}) {
    vec2 m = (g0.xy + g0.zw + g1.xy) / 3.0;
    float inr = tri_inradius(g0, g1);
    float f = inr > 0.0 ? r / inr : 1.0;
    return tri_dist(m + (p - m) / f, g0.xy, g0.zw, g1.xy) * f;
  }
  if (kind == ${PRIM.disc}) { return length(p - g0.xy) - r; }
  if (kind == ${PRIM.bar}) { return bar_dist(p, g0, r, g1.y); }
  if (kind == ${PRIM.poly}) {
    int first = int(g0.x);
    int count = int(g0.y);
    float d = count == 1 ? length(p - point_at(first)) : 1e9;
    for (int i = 0; i + 1 < count; i++) {
      d = min(d, seg_dist(p, point_at(first + i), point_at(first + i + 1)));
    }
    return d - r;
  }
  vec2 c = (g0.xy + g0.zw) * 0.5;
  vec2 q = abs(p - c) - ((g0.zw - g0.xy) * 0.5 - g1.x);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - g1.x;
}
float prim_radius(int kind, vec4 g0, vec4 g1, float lamp) {
  if (kind == ${PRIM.tri}) { return tri_inradius(g0, g1) * (g1.z > 0.0 ? clamp(lamp * ${TRI_FILL}, 0.0, 1.0) : 1.0); }
  if (kind == ${PRIM.disc}) { return g0.z * (g0.w > 0.0 ? lamp : 1.0); }
  if (kind == ${PRIM.bar}) { return g1.x; }
  if (kind == ${PRIM.poly}) { return g0.z; }
  return 0.0;
}
float prim_glow(int kind, vec4 g0, vec4 g1) {
  if (kind == ${PRIM.tri}) { return g1.w; }
  if (kind == ${PRIM.disc}) { return g1.x; }
  if (kind == ${PRIM.bar}) { return g1.z; }
  if (kind == ${PRIM.poly}) { return g0.w; }
  return 0.0;
}
vec4 prim_box(int kind, vec4 g0, vec4 g1, float r) {
  if (kind == ${PRIM.tri}) { return vec4(min(min(g0.xy, g0.zw), g1.xy), max(max(g0.xy, g0.zw), g1.xy)); }
  if (kind == ${PRIM.disc}) { return vec4(g0.xy - r, g0.xy + r); }
  if (kind == ${PRIM.bar}) { return vec4(min(g0.xy, g0.zw) - r, max(g0.xy, g0.zw) + r); }
  if (kind == ${PRIM.poly}) { return vec4(g1.xy - r, g1.zw + r); }
  return g0;
}
`;
